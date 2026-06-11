import type { EmailAdapter } from 'payload'

export type CloudflareEmailAddress = {
  email: string
  name?: string
}

export type CloudflareEmailRecipient = CloudflareEmailAddress | string

export type CloudflareEmailMessage = {
  bcc?: CloudflareEmailRecipient[]
  cc?: CloudflareEmailRecipient[]
  from: CloudflareEmailRecipient
  html?: string
  replyTo?: CloudflareEmailRecipient
  subject: string
  text?: string
  to: CloudflareEmailRecipient[]
}

export type CloudflareEmailResponse = {
  messageId: string
}

export type CloudflareEmailBinding = {
  send(message: CloudflareEmailMessage): Promise<CloudflareEmailResponse>
}

export type CloudflareEmailAdapterOptions = {
  binding: CloudflareEmailBinding
  defaultFromAddress: string
  defaultFromName: string
}

type PayloadEmailAddress = {
  address: string
  name?: string
}

type PayloadEmailRecipient = PayloadEmailAddress | string
type PayloadEmailRecipientValue = PayloadEmailRecipient | PayloadEmailRecipient[]

export const cloudflareEmailAdapter = ({
  binding,
  defaultFromAddress,
  defaultFromName,
}: CloudflareEmailAdapterOptions): EmailAdapter<CloudflareEmailResponse> => {
  return () => ({
    name: 'cloudflare-email-service',
    defaultFromAddress,
    defaultFromName,
    sendEmail: async (message) => {
      const html = typeof message.html === 'string' ? message.html : undefined
      const text =
        typeof message.text === 'string' ? message.text : html ? htmlToText(html) : undefined

      return binding.send({
        bcc: normalizeAddresses(message.bcc),
        cc: normalizeAddresses(message.cc),
        from:
          normalizeAddresses(message.from)[0] ?? {
            name: defaultFromName,
            email: defaultFromAddress,
          },
        html,
        replyTo: normalizeAddresses(message.replyTo)[0],
        subject: String(message.subject ?? ''),
        text,
        to: normalizeAddresses(message.to),
      })
    },
  })
}

function normalizeAddresses(
  value: PayloadEmailRecipientValue | undefined,
): CloudflareEmailRecipient[] {
  if (!value) {
    return []
  }

  const values = Array.isArray(value) ? value : [value]

  return values.flatMap((address) => {
    if (typeof address !== 'string') {
      return [
        {
          name: address.name,
          email: address.address,
        },
      ]
    }

    return address.split(',').map(parseAddress)
  })
}

function parseAddress(value: string): CloudflareEmailRecipient {
  const address = value.trim()
  const openingBracket = address.lastIndexOf('<')

  if (openingBracket < 1 || !address.endsWith('>')) {
    return address
  }

  let name = address.slice(0, openingBracket).trim()
  if (name.startsWith('"') && name.endsWith('"')) {
    name = name.slice(1, -1)
  }

  return {
    name,
    email: address.slice(openingBracket + 1, -1).trim(),
  }
}

function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
