import { Router, Response } from 'express'
import { requireAuth, AuthRequest } from '../middleware/auth'
import prisma from '../lib/prisma'

const router = Router()
router.use(requireAuth)

// ─── Helper: verify menu belongs to user ─────────────────────────────────────
async function getMenuForUser(menuId: string, userId: string) {
  return prisma.menu.findFirst({
    where: { id: menuId, business: { userId } },
  })
}

// ─── GET /api/menu/me ─────────────────────────────────────────────────────────
// Full menu with all categories + products for the logged-in user
router.get('/me', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const business = await prisma.business.findFirst({ where: { userId: req.userId } })
    if (!business) { res.json({ menu: null }); return }

    const menu = await prisma.menu.findFirst({
      where: { businessId: business.id },
      include: {
        categories: {
          orderBy: { order: 'asc' },
          include: { products: { orderBy: { order: 'asc' } } },
        },
        qrCode: true,
      },
    })
    res.json({ menu: menu || null })
  } catch (err) {
    console.error('GET /menu/me:', err)
    res.status(500).json({ message: 'Server error' })
  }
})

// ─── PATCH /api/menu/:menuId/template ────────────────────────────────────────
router.patch('/:menuId/template', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const menu = await getMenuForUser(req.params.menuId, req.userId!)
    if (!menu) { res.status(404).json({ message: 'Menu not found' }); return }

    const { templateId } = req.body
    const updated = await prisma.menu.update({
      where: { id: menu.id },
      data: { templateId: String(templateId ?? 0) },
    })
    res.json({ menu: updated })
  } catch (err) {
    console.error('PATCH /menu/:menuId/template:', err)
    res.status(500).json({ message: 'Server error' })
  }
})

// ─── POST /api/menu/:menuId/publish ──────────────────────────────────────────
router.post('/:menuId/publish', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const menu = await getMenuForUser(req.params.menuId, req.userId!)
    if (!menu) { res.status(404).json({ message: 'Menu not found' }); return }

    const updated = await prisma.menu.update({
      where: { id: menu.id },
      data: { isPublished: true, publishedAt: new Date() },
    })
    res.json({ menu: updated })
  } catch (err) {
    res.status(500).json({ message: 'Server error' })
  }
})

// ─── POST /api/menu/:menuId/unpublish ────────────────────────────────────────
router.post('/:menuId/unpublish', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const menu = await getMenuForUser(req.params.menuId, req.userId!)
    if (!menu) { res.status(404).json({ message: 'Menu not found' }); return }

    const updated = await prisma.menu.update({
      where: { id: menu.id },
      data: { isPublished: false },
    })
    res.json({ menu: updated })
  } catch (err) {
    res.status(500).json({ message: 'Server error' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/menu/:menuId/categories ───────────────────────────────────────
router.post('/:menuId/categories', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const menu = await getMenuForUser(req.params.menuId, req.userId!)
    if (!menu) { res.status(404).json({ message: 'Menu not found' }); return }

    const { name } = req.body
    if (!name) { res.status(400).json({ message: 'Category name is required' }); return }

    const count = await prisma.category.count({ where: { menuId: menu.id } })
    const category = await prisma.category.create({
      data: { menuId: menu.id, name, order: count },
      include: { products: true },
    })
    res.status(201).json({ category })
  } catch (err) {
    console.error('POST /menu/:menuId/categories:', err)
    res.status(500).json({ message: 'Server error' })
  }
})

// ─── PUT /api/menu/categories/:catId ─────────────────────────────────────────
router.put('/categories/:catId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cat = await prisma.category.findFirst({
      where: { id: req.params.catId, menu: { business: { userId: req.userId } } },
    })
    if (!cat) { res.status(404).json({ message: 'Category not found' }); return }

    const { name, order } = req.body
    const updated = await prisma.category.update({
      where: { id: cat.id },
      data: { ...(name && { name }), ...(order !== undefined && { order }) },
    })
    res.json({ category: updated })
  } catch (err) {
    res.status(500).json({ message: 'Server error' })
  }
})

// ─── DELETE /api/menu/categories/:catId ──────────────────────────────────────
router.delete('/categories/:catId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cat = await prisma.category.findFirst({
      where: { id: req.params.catId, menu: { business: { userId: req.userId } } },
    })
    if (!cat) { res.status(404).json({ message: 'Category not found' }); return }

    await prisma.category.delete({ where: { id: cat.id } })
    res.json({ message: 'Category deleted' })
  } catch (err) {
    res.status(500).json({ message: 'Server error' })
  }
})

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── POST /api/menu/categories/:catId/products ────────────────────────────────
router.post('/categories/:catId/products', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const cat = await prisma.category.findFirst({
      where: { id: req.params.catId, menu: { business: { userId: req.userId } } },
    })
    if (!cat) { res.status(404).json({ message: 'Category not found' }); return }

    const { name, price, description, isVeg, isBestseller, isSpecial, imageUrl, tags, availableDays } = req.body
    if (!name || price === undefined) {
      res.status(400).json({ message: 'Name and price are required' }); return
    }

    const count = await prisma.product.count({ where: { categoryId: cat.id } })
    const product = await prisma.product.create({
      data: {
        categoryId: cat.id,
        name,
        price,
        description: description || null,
        isVeg: isVeg ?? null,
        isBestseller: isBestseller || false,
        isSpecial: isSpecial || false,
        imageUrl: imageUrl || null,
        tags: tags || [],
        availableDays: availableDays || [],
        order: count,
      },
    })
    res.status(201).json({ product })
  } catch (err) {
    console.error('POST /menu/categories/:catId/products:', err)
    res.status(500).json({ message: 'Server error' })
  }
})

// ─── PUT /api/menu/products/:productId ───────────────────────────────────────
router.put('/products/:productId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.productId, category: { menu: { business: { userId: req.userId } } } },
    })
    if (!product) { res.status(404).json({ message: 'Product not found' }); return }

    const { name, price, description, isVeg, isBestseller, isSpecial, isAvailable, imageUrl, tags, order, availableDays } = req.body
    const updated = await prisma.product.update({
      where: { id: product.id },
      data: {
        ...(name !== undefined && { name }),
        ...(price !== undefined && { price }),
        ...(description !== undefined && { description }),
        ...(isVeg !== undefined && { isVeg }),
        ...(isBestseller !== undefined && { isBestseller }),
        ...(isSpecial !== undefined && { isSpecial }),
        ...(isAvailable !== undefined && { isAvailable }),
        ...(imageUrl !== undefined && { imageUrl }),
        ...(tags !== undefined && { tags }),
        ...(order !== undefined && { order }),
        ...(availableDays !== undefined && { availableDays }),
        ...(req.body.disabledDate !== undefined && { disabledDate: req.body.disabledDate }),
      },
    })
    res.json({ product: updated })
  } catch (err) {
    res.status(500).json({ message: 'Server error' })
  }
})

// ─── PATCH /api/menu/products/:productId/today-toggle ────────────────────────
// Disable or re-enable an item for today only. Auto-resets tomorrow.
router.patch('/products/:productId/today-toggle', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.productId, category: { menu: { business: { userId: req.userId } } } },
    })
    if (!product) { res.status(404).json({ message: 'Product not found' }); return }

    // Use client-provided local date so timezone matches the owner's browser
    const todayStr: string = req.body.localDate || new Date().toISOString().slice(0, 10)
    const isDisabledToday = product.disabledDate === todayStr

    const updated = await prisma.product.update({
      where: { id: product.id },
      data: { disabledDate: isDisabledToday ? null : todayStr },
    })
    res.json({ product: updated, disabledToday: !isDisabledToday })
  } catch (err) {
    console.error('PATCH /menu/products/:id/today-toggle:', err)
    res.status(500).json({ message: 'Server error' })
  }
})

// ─── DELETE /api/menu/products/:productId ────────────────────────────────────
router.delete('/products/:productId', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const product = await prisma.product.findFirst({
      where: { id: req.params.productId, category: { menu: { business: { userId: req.userId } } } },
    })
    if (!product) { res.status(404).json({ message: 'Product not found' }); return }

    await prisma.product.delete({ where: { id: product.id } })
    res.json({ message: 'Product deleted' })
  } catch (err) {
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
