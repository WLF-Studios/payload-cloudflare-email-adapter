/* eslint-disable perfectionist/sort-objects */
import { Readable } from 'node:stream'
import { describe, expect, test, vi } from 'vitest'

import {
  cloudflareEmailAdapter,
  type CloudflareEmailBinding,
  type CloudflareEmailMessage,
  type CloudflareEmailResponse,
} from '../src/index.js'

type AdapterFixtureOptions = {
  maxMessageBytes?: number
  response?: CloudflareEmailResponse
}

function createAdapter({
  maxMessageBytes,
  response = { messageId: 'message-123' },
}: AdapterFixtureOptions = {}) {
  const send = vi.fn((_message: CloudflareEmailMessage) => Promise.resolve(response))
  const binding: CloudflareEmailBinding = { send }
  const adapter = cloudflareEmailAdapter({
    binding,
    defaultFromAddress: 'noreply@example.com',
    defaultFromName: 'Example',
    maxMessageBytes,
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

  test('materializes Readable attachment content for Cloudflare', async () => {
    const { adapter, send } = createAdapter()

    await adapter.sendEmail({
      attachments: [
        {
          content: Readable.from([new Uint8Array([0, 1]), 'A', new Uint8Array([254, 255])]),
          contentType: 'application/octet-stream',
          filename: 'payload.bin',
        },
      ],
      subject: 'Stream attachment',
      to: 'guest@example.com',
    })

    expect(send.mock.calls[0]?.[0].attachments).toEqual([
      {
        content: new Uint8Array([0, 1, 65, 254, 255]),
        disposition: 'attachment',
        filename: 'payload.bin',
        type: 'application/octet-stream',
      },
    ])
  })

  test('rejects an oversized email payload without attachments', async () => {
    const { adapter, send } = createAdapter({ maxMessageBytes: 256 })

    await expect(
      adapter.sendEmail({
        subject: 'Oversized body',
        text: 'x'.repeat(256),
        to: 'guest@example.com',
      }),
    ).rejects.toMatchObject({
      message: 'Email payload exceeds the configured 256-byte limit',
      status: 400,
    })

    expect(send).not.toHaveBeenCalled()
  })

  test('rejects when the completed message exceeds the configured limit', async () => {
    const { adapter, send } = createAdapter({ maxMessageBytes: 1024 })

    await expect(
      adapter.sendEmail({
        attachments: [
          {
            content: Buffer.from(new Uint8Array(400)),
            contentType: 'application/octet-stream',
            filename: 'payload.bin',
          },
        ],
        subject: 'Combined payload',
        text: 'x'.repeat(700),
        to: 'guest@example.com',
      }),
    ).rejects.toMatchObject({
      message: 'Email payload exceeds the configured 1024-byte limit',
      status: 400,
    })

    expect(send).not.toHaveBeenCalled()
  })

  test('stops buffering before attachments exceed the configured message limit', async () => {
    const { adapter, send } = createAdapter({ maxMessageBytes: 2048 })
    const overflowingStream = Readable.from(['é'.repeat(1024)])

    await expect(
      adapter.sendEmail({
        attachments: [
          {
            content: Readable.from([new Uint8Array(256)]),
            contentType: 'application/octet-stream',
            filename: 'first.bin',
          },
          {
            content: overflowingStream,
            contentType: 'application/octet-stream',
            filename: 'second.bin',
          },
        ],
        subject: 'Oversized stream attachments',
        to: 'guest@example.com',
      }),
    ).rejects.toMatchObject({
      message: 'Email payload exceeds the configured 2048-byte limit',
      status: 400,
    })

    expect(overflowingStream.destroyed).toBe(true)
    expect(send).not.toHaveBeenCalled()
  })

  test('maps Nodemailer string encodings and inline content IDs', async () => {
    const { adapter, send } = createAdapter()

    await adapter.sendEmail({
      attachments: [
        {
          content: 'plain text',
          contentType: 'text/plain',
          filename: 'plain.txt',
        },
        {
          cid: 'logo@example',
          content: 'AQID',
          contentType: 'image/png',
          encoding: 'base64',
          filename: 'logo.png',
        },
      ],
      subject: 'String attachments',
      to: 'guest@example.com',
    })

    expect(send.mock.calls[0]?.[0].attachments).toEqual([
      {
        content: new TextEncoder().encode('plain text'),
        disposition: 'attachment',
        filename: 'plain.txt',
        type: 'text/plain',
      },
      {
        content: 'AQID',
        contentId: 'logo@example',
        disposition: 'inline',
        filename: 'logo.png',
        type: 'image/png',
      },
    ])
  })

  test('propagates errors without a Cloudflare code', async () => {
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
