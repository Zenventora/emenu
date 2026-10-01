import axios, { type InternalAxiosRequestConfig } from 'axios'

// Bug fix: extend axios config type to include the _retry flag used by the
// response interceptor. Without this, TypeScript infers _retry as `any` and
// may strip it in strict mode, causing infinite retry loops on 401 responses.
interface RetryableRequest extends InternalAxiosRequestConfig {
  _retry?: boolean
}

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
    const originalRequest = error.config as RetryableRequest
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
