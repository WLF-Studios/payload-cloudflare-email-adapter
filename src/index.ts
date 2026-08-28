import { APIError, type EmailAdapter, type SendEmailOptions } from 'payload'

/** This caps the structured message payload; Cloudflare validates the final encoded message.
 * @link https://developers.cloudflare.com/email-service/platform/limits/#email-content-limits
 */
const DEFAULT_MAX_MESSAGE_BYTES = 5 * 1024 * 1024

const CLOUDFLARE_ERROR_STATUSES: Readonly<Record<string, number>> = {
  E_CONTENT_TOO_LARGE: 413,
  E_DAILY_LIMIT_EXCEEDED: 429,
  E_DELIVERY_FAILED: 502,
  E_FIELD_MISSING: 400,
  E_HEADER_NAME_INVALID: 400,
  E_HEADER_NOT_ALLOWED: 400,
  E_HEADER_USE_API_FIELD: 400,
  E_HEADER_VALUE_INVALID: 400,
  E_HEADER_VALUE_TOO_LONG: 400,
  E_HEADERS_TOO_LARGE: 400,
  E_HEADERS_TOO_MANY: 400,
  E_INTERNAL_SERVER_ERROR: 502,
  E_RATE_LIMIT_EXCEEDED: 429,
  E_RECIPIENT_NOT_ALLOWED: 400,
  E_RECIPIENT_SUPPRESSED: 400,
  E_SENDER_DOMAIN_NOT_AVAILABLE: 400,
  E_SENDER_NOT_VERIFIED: 400,
  E_TOO_MANY_ATTACHMENTS: 400,
  E_TOO_MANY_RECIPIENTS: 400,
  E_VALIDATION_ERROR: 400,
}

export type CloudflareEmailAddress = {
  email: string
  name?: string
}

export type CloudflareEmailRecipient = CloudflareEmailAddress | string

export type CloudflareAttachment = {
  content: ArrayBuffer | ArrayBufferView | string
  contentId?: string
  disposition: 'attachment' | 'inline'
  filename: string
  type: string
}

export type CloudflareEmailMessage = {
  attachments?: CloudflareAttachment[]
  bcc?: CloudflareEmailRecipient[]
  cc?: CloudflareEmailRecipient[]
  from: CloudflareEmailRecipient
  headers?: Record<string, string>
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
  maxMessageBytes?: number
}

type PayloadAttachment = NonNullable<SendEmailOptions['attachments']>[number]

export const cloudflareEmailAdapter = ({
  binding,
  defaultFromAddress,
  defaultFromName,
  maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES,
}: CloudflareEmailAdapterOptions): EmailAdapter<CloudflareEmailResponse> => {
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= 0) {
    throw new RangeError('maxMessageBytes must be a positive safe integer')
  }

  return () => ({
    name: 'cloudflare-email-service',
    defaultFromAddress,
    defaultFromName,
    sendEmail: async (message) => {
      const html = typeof message.html === 'string' ? message.html : undefined
      const text =
        typeof message.text === 'string' ? message.text : html ? htmlToText(html) : undefined

      const to = normalizeAddresses(message.to)

      if (to.length > 50) {
        // Cloudflare Email Service allows a maximum of 50 recipients per message
        throw new APIError('Too many recipients: maximum allowed is 50', 400)
      }

      const emailMessage: CloudflareEmailMessage = {
        bcc: normalizeAddresses(message.bcc),
        cc: normalizeAddresses(message.cc),
        from: normalizeAddresses(message.from)[0] ?? {
          name: defaultFromName,
          email: defaultFromAddress,
        },
        headers: mapHeaders(message.headers),
        html,
        replyTo: normalizeAddresses(message.replyTo)[0],
        subject: String(message.subject ?? ''),
        text,
        to,
      }
      const attachments = await mapAttachments(message.attachments, maxMessageBytes)
      if (attachments) {
        emailMessage.attachments = attachments
      }

      if (getMessageByteLength(emailMessage) > maxMessageBytes) {
        throw new APIError(
          `Email payload exceeds the configured ${maxMessageBytes}-byte limit`,
          400,
        )
      }

      try {
        return await binding.send(emailMessage)
      } catch (error) {
        if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
          throw new APIError(
            `Error sending email: ${error.message}`,
            CLOUDFLARE_ERROR_STATUSES[error.code] ?? 500,
            { code: error.code },
          )
        }

        throw error
      }
    },
  })
}

function normalizeAddresses(
  value: SendEmailOptions['from'] | undefined,
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
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getAttachmentContentByteLength(content: CloudflareAttachment['content']): number {
  if (typeof content === 'string') {
    // String attachment content reaches Cloudflare only as base64, which is ASCII.
    return content.length
  }

  return content.byteLength
}

function getMessageByteLength(message: CloudflareEmailMessage): number {
  const attachments = message.attachments ?? []
  const attachmentBytes = attachments.reduce(
    (total, attachment) => total + getAttachmentContentByteLength(attachment.content),
    0,
  )
  const serializableMessage = {
    ...message,
    attachments: message.attachments?.map((attachment) => ({
      type: attachment.type,
      content: '',
      ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
      disposition: attachment.disposition,
      filename: attachment.filename,
    })),
  }

  return new TextEncoder().encode(JSON.stringify(serializableMessage)).byteLength + attachmentBytes
}

async function mapAttachments(
  attachments: SendEmailOptions['attachments'],
  maxMessageBytes: number,
): Promise<CloudflareAttachment[] | undefined> {
  if (!attachments?.length) {
    return undefined
  }

  const mappedAttachments: CloudflareAttachment[] = []
  let attachmentBytes = 0

  for (const attachment of attachments) {
    if (!attachment.filename) {
      throw new APIError('Attachment is missing filename', 400)
    }

    if (attachment.content === undefined) {
      throw new APIError(
        attachment.path
          ? 'Attachment paths are not supported; provide attachment content instead'
          : 'Attachment is missing content',
        400,
      )
    }

    if (!attachment.contentType) {
      throw new APIError('Attachment is missing content type', 400)
    }

    const content = await mapAttachmentContent(
      attachment.content,
      attachment.encoding,
      maxMessageBytes - attachmentBytes,
      maxMessageBytes,
    )
    const contentBytes = getAttachmentContentByteLength(content)

    if (contentBytes > maxMessageBytes - attachmentBytes) {
      throw new APIError(`Email payload exceeds the configured ${maxMessageBytes}-byte limit`, 400)
    }

    attachmentBytes += contentBytes

    mappedAttachments.push({
      type: attachment.contentType,
      content,
      ...(attachment.cid ? { contentId: attachment.cid } : {}),
      disposition: attachment.contentDisposition ?? (attachment.cid ? 'inline' : 'attachment'),
      filename: attachment.filename,
    })
  }

  return mappedAttachments
}

async function mapAttachmentContent(
  content: NonNullable<PayloadAttachment['content']>,
  encoding: PayloadAttachment['encoding'],
  maxBytes: number,
  maxMessageBytes: number,
): Promise<CloudflareAttachment['content']> {
  if (typeof content === 'string') {
    const normalizedEncoding = encoding?.toLowerCase()

    if (normalizedEncoding === 'base64') {
      return content
    }

    if (!normalizedEncoding || normalizedEncoding === 'utf8' || normalizedEncoding === 'utf-8') {
      return new TextEncoder().encode(content)
    }

    throw new APIError(`Attachment string encoding "${encoding}" is not supported`, 400)
  }

  if (ArrayBuffer.isView(content)) {
    return content
  }

  return readAttachmentStream(content, maxBytes, maxMessageBytes)
}

async function readAttachmentStream(
  stream: AsyncIterable<unknown>,
  maxBytes: number,
  maxMessageBytes: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let byteLength = 0

  for await (const chunk of stream) {
    const bytes = attachmentChunkToBytes(chunk)

    if (bytes.byteLength > maxBytes - byteLength) {
      throw new APIError(`Email payload exceeds the configured ${maxMessageBytes}-byte limit`, 400)
    }

    chunks.push(bytes)
    byteLength += bytes.byteLength
  }

  const content = new Uint8Array(byteLength)
  let offset = 0

  for (const chunk of chunks) {
    content.set(chunk, offset)
    offset += chunk.byteLength
  }

  return content
}

function attachmentChunkToBytes(chunk: unknown): Uint8Array {
  if (typeof chunk === 'string') {
    return new TextEncoder().encode(chunk)
  }

  if (chunk instanceof ArrayBuffer) {
    return new Uint8Array(chunk)
  }

  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  }

  throw new APIError('Attachment stream emitted an unsupported chunk type', 400)
}

function mapHeaders(headers: SendEmailOptions['headers']): Record<string, string> | undefined {
  if (!headers) {
    return undefined
  }

  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string>>((acc, { key, value }) => {
      acc[key] = value
      return acc
    }, {})
  }

  return Object.entries(headers).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === 'string') {
      acc[key] = value
    } else if (Array.isArray(value)) {
      acc[key] = value.join(', ')
    } else {
      acc[key] = value.value
    }
    return acc
  }, {})
}
