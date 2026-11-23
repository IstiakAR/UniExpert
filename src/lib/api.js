export class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(
      'Cannot reach the campus server. Is the API running?',
      0,
    )
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new ApiError(data.error || 'Something went wrong.', response.status)
  }
  return data
}

export const api = {
  me: () => request('/api/auth/me'),
  login: (email, password, remember = true) =>
    request('/api/auth/login', {
      method: 'POST',
      body: { email, password, remember },
    }),
  register: (payload) =>
    request('/api/auth/register', { method: 'POST', body: payload }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  stats: () => request('/api/stats'),
  experts: (query = '') =>
    request(`/api/experts${query ? `?q=${encodeURIComponent(query)}` : ''}`),
  posts: () => request('/api/posts'),
  createPost: (body, tag) =>
    request('/api/posts', { method: 'POST', body: { body, tag } }),
  likePost: (id) => request(`/api/posts/${id}/like`, { method: 'POST' }),
  deletePost: (id) => request(`/api/posts/${id}`, { method: 'DELETE' }),

  requests: () => request('/api/requests'),
  createRequest: (expertId, message) =>
    request('/api/requests', { method: 'POST', body: { expertId, message } }),
  respondToRequest: (id, status) =>
    request(`/api/requests/${id}`, { method: 'PATCH', body: { status } }),

  pendingUsers: () => request('/api/admin/pending'),
  approveUser: (id) =>
    request(`/api/admin/users/${id}/approve`, { method: 'PATCH' }),
}
