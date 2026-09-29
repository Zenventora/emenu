import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma'

const router = Router()

// Day abbreviation for filtering
const DAY_ABBR = ['sun','mon','tue','wed','thu','fri','sat']

// ─── GET /api/public/menu/:slug ───────────────────────────────────────────────
// Customer-facing: returns full menu data for a business by slug
router.get('/menu/:slug', async (req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date()
    // Use local date so it matches the restaurant owner's browser timezone
    const todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0')
    const todayAbbr = DAY_ABBR[now.getDay()] // e.g. 'mon'

    const business = await prisma.business.findUnique({
      where: { slug: req.params.slug },
      include: {
        menus: {
          where: { isPublished: true },
          take: 1,
          include: {
            categories: {
              orderBy: { order: 'asc' },
              include: {
                products: {
                  where: { isAvailable: true },
                  orderBy: { order: 'asc' },
                },
              },
            },
            qrCode: true,
          },
        },
      },
    })

    if (!business) { res.status(404).json({ message: 'Menu not found' }); return }

    // Check if any menu exists (published or not) — for "closed today" UX
    const anyMenu = await prisma.menu.findFirst({ where: { businessId: business.id } })
    const menu = business.menus[0]

    if (!menu) {
      if (anyMenu) {
        // Business exists but closed today
        res.status(200).json({
          closed: true,
          business: { name: business.name, logoUrl: business.logoUrl, tagline: business.tagline },
        })
      } else {
        res.status(404).json({ message: 'Menu not found' })
      }
      return
    }

    res.json({
      business: {
        name: business.name,
        slug: business.slug,
        tagline: business.tagline,
        logoUrl: business.logoUrl,
        phone: business.phone,
        whatsapp: business.whatsapp,
        location: business.location,
        address: business.address,
        instagram: business.instagram,
        facebook: business.facebook,
        openingHours: business.openingHours,
      },
      menu: {
        id: menu.id,
        templateId: menu.templateId,
        categories: menu.categories.map(cat => ({
          id: cat.id,
          name: cat.name,
          // Filter: if availableDays is empty → always available; else must include today
          products: cat.products
            .filter(p => p.disabledDate !== todayStr)
            .filter(p => !p.availableDays.length || p.availableDays.includes(todayAbbr))
            .map(p => ({
              id: p.id,
              name: p.name,
              description: p.description,
              price: p.price,
              imageUrl: p.imageUrl,
              isVeg: p.isVeg,
              isBestseller: p.isBestseller,
              isSpecial: p.isSpecial,
              tags: p.tags,
              availableDays: p.availableDays,
            })),
        })).filter(cat => cat.products.length > 0), // hide empty categories
      },
    })
  } catch (err) {
    console.error('GET /public/menu/:slug:', err)
    res.status(500).json({ message: 'Server error' })
  }
})

export default router
