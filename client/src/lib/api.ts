import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // Send cookies with every request
  headers: {
    'Content-Type': 'application/json',
  },
})

// Response interceptor — handle token expiry silently
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      try {
        await api.post('/auth/refresh')
        return api(originalRequest)
      } catch {
        // Refresh failed → clear auth state
        window.dispatchEvent(new Event('auth:logout'))
      }
    }
    return Promise.reject(error)
  }
)

export default api
