import { APP } from '../config'

/** A non-2xx API response, carrying enough context to diagnose seeding failures
 * without opening the trace: the method, URL, status, and response body. */
export class ApiError extends Error {
  constructor(
    readonly method: string,
    readonly url: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${method} ${url} → ${status}\n${body}`)
    this.name = 'ApiError'
  }
}

interface ProvisionInput {
  hotel: { name: string; address: string | null }
  rooms: Array<{
    room_number: string
    floor?: number | null
    room_type?: string | null
    status?: string
  }>
  users: Array<{ name: string; email: string; role: 'manager' | 'housekeeper' }>
}

interface ProvisionResult {
  hotel: { id: string; name: string; address: string | null }
  rooms_created: number
  users: Array<{ id: string; email: string; name: string; role: string }>
  temporary_password: string
}

interface RoomRead {
  id: string
  room_number: string
  floor: number | null
  room_type: string | null
  status: string
}

interface TaskRead {
  id: string
  room_id: string
  assigned_to: string | null
  status: string
  priority: string
  notes: string | null
  due_date: string | null
}

/**
 * A thin, bearer-token API client for seeding and out-of-band assertions.
 *
 * Seeding goes through the *real* backend endpoints (no direct DB writes) so the
 * data the UI sees is exactly what a real admin would have created. Every call
 * throws an {@link ApiError} on non-2xx so a failed setup is self-describing.
 */
export class Api {
  private token: string | null = null

  constructor(private readonly baseUrl: string = APP.api) {}

  /** Build a client already authenticated as the given identity. */
  static async loggedIn(email: string, password: string): Promise<Api> {
    const api = new Api()
    await api.login(email, password)
    return api
  }

  async login(email: string, password: string): Promise<{ access_token: string }> {
    const data = await this.request<{ access_token: string }>(
      'POST',
      '/api/v1/auth/login',
      { email, password },
    )
    this.token = data.access_token
    return data
  }

  me(): Promise<{ id: string; email: string; role: string; hotel_id: string | null; must_change_password: boolean }> {
    return this.request('GET', '/api/v1/auth/me')
  }

  changeOwnPassword(current_password: string, new_password: string): Promise<void> {
    return this.request('PUT', '/api/v1/auth/me/password', {
      current_password,
      new_password,
    })
  }

  forgotPassword(email: string): Promise<{ message: string }> {
    return this.request('POST', '/api/v1/auth/forgot-password', { email })
  }

  provision(input: ProvisionInput): Promise<ProvisionResult> {
    return this.request('POST', '/api/v1/hotels/provision', input)
  }

  listRooms(hotelId: string): Promise<RoomRead[]> {
    return this.request('GET', `/api/v1/hotels/${hotelId}/rooms`)
  }

  listTasks(
    hotelId: string,
    params: { assignedTo?: string; status?: string } = {},
  ): Promise<TaskRead[]> {
    const q = new URLSearchParams()
    if (params.assignedTo) q.set('assigned_to', params.assignedTo)
    if (params.status) q.set('status', params.status)
    const suffix = q.toString() ? `?${q}` : ''
    return this.request('GET', `/api/v1/hotels/${hotelId}/tasks${suffix}`)
  }

  createTask(
    hotelId: string,
    body: {
      room_id: string
      assigned_to?: string | null
      status?: string
      priority?: string
      notes?: string | null
      due_date?: string | null
    },
  ): Promise<TaskRead> {
    return this.request('POST', `/api/v1/hotels/${hotelId}/tasks`, body)
  }

  /** File a manager's access request (staff/room add or remove) for admin
   * approval. Used to seed the admin Requests queue in admin.spec. */
  fileRequest(
    hotelId: string,
    body: {
      resource: 'staff' | 'room'
      kind: 'add' | 'remove'
      payload?: Record<string, unknown>
      target_id?: string
      note?: string | null
    },
  ): Promise<{ id: string }> {
    return this.request('POST', `/api/v1/hotels/${hotelId}/access-requests`, body)
  }

  setRoomStatus(hotelId: string, roomId: string, status: string): Promise<RoomRead> {
    return this.request(
      'PATCH',
      `/api/v1/hotels/${hotelId}/rooms/${roomId}/status`,
      { status },
    )
  }

  getRoom(hotelId: string, roomId: string): Promise<RoomRead> {
    return this.request('GET', `/api/v1/hotels/${hotelId}/rooms/${roomId}`)
  }

  /** Raw request. Public so specs can drive arbitrary endpoints for boundary
   * checks (e.g. asserting a cross-tenant read 404s). */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new ApiError(method, url, res.status, text)
    return (text ? JSON.parse(text) : null) as T
  }

  /** Like {@link request} but returns the status instead of throwing — for
   * boundary tests that assert a specific 4xx (403/404/409). */
  async rawStatus(method: string, path: string, body?: unknown): Promise<number> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return res.status
  }
}
