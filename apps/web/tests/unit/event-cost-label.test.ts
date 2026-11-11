/**
 * The team fee in its own currency. FIRST Israel charges 2,000 shekels and
 * Canadian events charge CAD; the column held dollars only until 2026-11-11,
 * and a shekel fee printed as "$2000".
 */
import { describe, it, expect } from 'bun:test'
import { costLabel, costCurrencyOptions, formatCost, parseCostCurrency } from '@/lib/events/event-display'

describe('costLabel', () => {
  it('keeps a dollar fee as it always read', () => {
    expect(costLabel({ costUsd: 300, costCurrency: 'USD', costNote: null })).toBe('$300')
    expect(costLabel({ costUsd: 300, costNote: null })).toBe('$300')
  })

  it('prints another currency with its own symbol', () => {
    expect(costLabel({ costUsd: 450, costCurrency: 'CAD', costNote: null })).toBe('CA$450')
    expect(costLabel({ costUsd: 2000, costCurrency: 'ILS', costNote: null })).toBe('₪2,000')
  })

  it('reads zero as Free whatever the currency', () => {
    expect(costLabel({ costUsd: 0, costCurrency: 'ILS', costNote: null })).toBe('Free')
  })

  it('keeps the note after the amount', () => {
    expect(costLabel({ costUsd: 450, costCurrency: 'CAD', costNote: 'both days' })).toBe('CA$450 · both days')
  })

  it('does not throw on a code Intl does not know', () => {
    expect(formatCost(10, 'QQQ')).toContain('10')
  })
})

describe('currency input', () => {
  it('offers USD first and keeps a code the row already holds', () => {
    expect(costCurrencyOptions('USD')[0]).toBe('USD')
    expect(costCurrencyOptions('NZD')).toContain('NZD')
    expect(costCurrencyOptions('CAD').filter((c) => c === 'CAD')).toHaveLength(1)
  })

  it('parses three letters, upper-cased, and nothing else', () => {
    expect(parseCostCurrency(' cad ')).toBe('CAD')
    expect(parseCostCurrency('C$')).toBeNull()
    expect(parseCostCurrency(undefined)).toBeNull()
  })
})
