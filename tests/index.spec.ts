/* eslint-disable perfectionist/sort-objects */
import { describe, expect, test, vi } from 'vitest'

import {
  cloudflareEmailAdapter,
  type CloudflareEmailBinding,
  type CloudflareEmailMessage,
} from '../src/index.js'

function createAdapter(response = { messageId: 'message-123' }) {
  const send = vi.fn((_message: CloudflareEmailMessage) => Promise.resolve(response))
  const binding: CloudflareEmailBinding = { send }
  const adapter = cloudflareEmailAdapter({
    binding,
    defaultFromAddress: 'noreply@example.com',
    defaultFromName: 'Example',
  })({ payload: {} as never })

  return { adapter, send }
}

describe('cloudflareEmailAdapter', () => {
  test('maps a Payload Form Builder email to Cloudflare', async () => {
    const { adapter, send } = createAdapter()

    await adapter.sendEmail({
      bcc: 'archive@example.com',
      cc: 'manager@example.com',
      from: '"Example" <info@example.com>',
      html: '<p>Thank you for contacting us.</p>',
      replyTo: '"Guest" <guest@example.com>',
      subject: 'Thanks for reaching out!',
      to: 'guest@example.com, other@example.com',
    })

    expect(send).toHaveBeenCalledWith({
      bcc: ['archive@example.com'],
      cc: ['manager@example.com'],
      from: { email: 'info@example.com', name: 'Example' },
      html: '<p>Thank you for contacting us.</p>',
      replyTo: { email: 'guest@example.com', name: 'Guest' },
      subject: 'Thanks for reaching out!',
      text: 'Thank you for contacting us.',
      to: ['guest@example.com', 'other@example.com'],
    })
  })

  test('uses the default sender when Email From is empty', async () => {
    const { adapter, send } = createAdapter()

    await adapter.sendEmail({
      subject: 'Contact form',
      text: 'Message',
      to: 'guest@example.com',
    })

    expect(send.mock.calls[0]?.[0].from).toEqual({
      email: 'noreply@example.com',
      name: 'Example',
    })
  })

  test('returns the Cloudflare response', async () => {
    const response = { messageId: 'message-456' }
    const { adapter } = createAdapter(response)

    await expect(
      adapter.sendEmail({
        subject: 'Contact form',
        to: 'guest@example.com',
      }),
    ).resolves.toBe(response)
  })

  test('propagates Cloudflare errors', async () => {
    const error = new Error('Email failed')
    const binding: CloudflareEmailBinding = {
      send: vi.fn(() => Promise.reject(error)),
    }
    const adapter = cloudflareEmailAdapter({
      binding,
      defaultFromAddress: 'noreply@example.com',
      defaultFromName: 'Example',
    })({ payload: {} as never })

    await expect(
      adapter.sendEmail({
        subject: 'Contact form',
        to: 'guest@example.com',
      }),
    ).rejects.toBe(error)
  })
})
