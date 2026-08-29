import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DashboardView } from './DashboardView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

const okRow = {
  id: 'u1', request_id: 'r1', virtual_model_id: 'vm1', provider_id: 'deepseek', provider_name: 'DeepSeek', provider_model_id: 'deepseek-chat', input_tokens: 100, output_tokens: 50, cached_tokens: 0, estimated_cost: 0.01, latency_ms: 500, status: 'success', error_code: null, error_message: null, route_attempt: 0, created_at: '2026-01-01T00:00:00Z'
}

const errRow = {
  id: 'u2', request_id: 'r2', virtual_model_id: 'vm1', provider_id: 'deepseek', provider_name: 'DeepSeek', provider_model_id: 'deepseek-chat', input_tokens: 0, output_tokens: 0, cached_tokens: 0, estimated_cost: null, latency_ms: 1200, status: 'error', error_code: 'AUTH_ERROR', error_message: 'Invalid API key provided.', route_attempt: 0, created_at: '2026-01-02T00:00:00Z'
}

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.usageDashboardTotals.mockResolvedValue({
      totalRequests: 25, totalTokens: 1000, totalCost: 0.25,
      successRequests: 24, errorRequests: 1, abortedRequests: 0,
      byProvider: [{ provider_id: 'deepseek', provider_name: 'DeepSeek', request_count: 25, total_cost: 0.25 }]
    })
    gw.usageListPage.mockResolvedValue({ rows: [errRow, okRow], total: 25 })
    gw.usageListRecent.mockResolvedValue([okRow])
  })

  it('renders totals', async () => {
    render(<DashboardView />)
    expect(await screen.findAllByText('25')).toBeTruthy()
    expect(screen.getAllByText(/0.25/).length).toBeGreaterThan(0)
  })

  it('renders recent requests', async () => {
    render(<DashboardView />)
    expect(await screen.findByText(/r1/)).toBeTruthy()
  })

  it('shows provider display name in by-provider', async () => {
    render(<DashboardView />)
    expect(await screen.findAllByText('DeepSeek')).toBeTruthy()
  })

  it('shows error message for failed requests', async () => {
    render(<DashboardView />)
    expect(await screen.findByText(/Invalid API key provided/)).toBeTruthy()
  })

  it('paginates recent requests', async () => {
    render(<DashboardView />)
    expect(await screen.findByText(/r1/)).toBeTruthy()
    const next = screen.getByRole('button', { name: /Next/i })
    next.click()
    expect(gw.usageListPage).toHaveBeenCalledWith(2, 10)
  })

  it('manual reload refreshes totals and the current page', async () => {
    render(<DashboardView />)
    expect(await screen.findByText(/r1/)).toBeTruthy()
    gw.usageDashboardTotals.mockClear()
    gw.usageListPage.mockClear()
    const reload = screen.getByRole('button', { name: /Reload/i })
    reload.click()
    expect(await screen.findByRole('button', { name: /Reload/i })).toBeTruthy()
    expect(gw.usageDashboardTotals).toHaveBeenCalled()
    expect(gw.usageListPage).toHaveBeenCalledWith(1, 10)
  })
})
