import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DashboardView } from './DashboardView'

const gw = window.meowGateway as unknown as Record<string, ReturnType<typeof vi.fn>>

describe('DashboardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gw.usageDashboardTotals.mockResolvedValue({
      totalRequests: 10, totalTokens: 1000, totalCost: 0.25,
      successRequests: 9, errorRequests: 1, abortedRequests: 0,
      byProvider: [{ provider_id: 'deepseek', request_count: 10, total_cost: 0.25 }]
    })
    gw.usageListRecent.mockResolvedValue([
      { id: 'u1', request_id: 'r1', virtual_model_id: 'vm1', provider_id: 'deepseek', provider_model_id: 'deepseek-chat', input_tokens: 100, output_tokens: 50, cached_tokens: 0, estimated_cost: 0.01, latency_ms: 500, status: 'success', error_code: null, route_attempt: 0, created_at: '2026-01-01T00:00:00Z' }
    ])
  })

  it('renders totals', async () => {
    render(<DashboardView />)
    expect(await screen.findAllByText('10')).toBeTruthy()
    expect(screen.getAllByText(/0.25/).length).toBeGreaterThan(0)
  })

  it('renders recent requests', async () => {
    render(<DashboardView />)
    expect(await screen.findByText(/r1/)).toBeTruthy()
  })
})
