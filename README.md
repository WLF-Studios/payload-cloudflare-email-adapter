# Payload Cloudflare Email Adapter

Payload email adapter that sends transactional email through the Cloudflare Email Service Workers
binding.

<p align="center">
  <img alt="Payload Cloudflare Email Adapter" src="assets/pcea-cover.jpg" width="100%" />
</p>

Built for Payload applications deployed to Cloudflare Workers. It uses Cloudflare's native
`send_email` binding, so it does not require an API token or use the Cloudflare REST API.

Tested with Payload `3.84`.

## Install

```bash
pnpm add payload-cloudflare-email-adapter
```

## Quick Setup

Add `cloudflareEmailAdapter()` to your Payload config file `src/payload.config.ts`:

```ts
// src/payload.config.ts
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { buildConfig } from 'payload'
import { cloudflareEmailAdapter } from 'payload-cloudflare-email-adapter'

const { env } = await getCloudflareContext({ async: true })

export default buildConfig({
  email: cloudflareEmailAdapter({
    binding: env.EMAIL,
    defaultFromAddress: 'noreply@example.com',
    defaultFromName: 'Example',
  }),
})
```

Enable Email Sending for the sender domain:

```bash
pnpm exec wrangler email sending enable example.com
```

Add the binding to `wrangler.jsonc`:

```jsonc
{
  "send_email": [
    {
      "name": "EMAIL",
      "allowed_sender_addresses": ["noreply@example.com"],
    },
  ],
}
```

Generate the Worker environment types after adding the binding:

```bash
pnpm exec wrangler types
```

## Enable Email Sending

Cloudflare Email Service requires the sender domain to use Cloudflare DNS and be onboarded for
Email Sending.

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com/).
2. Open the account containing your domain.
3. Go to **Compute > Email Service > Email Sending**.
4. Select **Onboard Domain**.
5. Choose the sender domain.
6. Review the DNS records Cloudflare will create:
   - MX records for bounce handling
   - SPF TXT record
   - DKIM TXT record
   - DMARC TXT record
7. Select **Done**.
8. Wait until the domain status becomes active.

Activation usually takes 5–15 minutes but can take up to 24 hours.

For your project:

- Domain: `example.com`
- Binding: `EMAIL`
- Sender: `noreply@example.com`

Deploy the Payload Worker after onboarding the domain. Wrangler creates the `EMAIL` binding from
your `wrangler.jsonc`.

Configure Payload Form Builder emails with:

```text
Email From: noreply@example.com
Reply To: {{email}}
```

The **Email From** address must remain under the onboarded domain. **Reply To** can use the
customer's submitted email address.

This Workers binding setup does not require:

- Email Routing
- a Cloudflare API token
- SMTP credentials
- a separate `noreply` mailbox
- a verified recipient list

Cloudflare Email Sending is for transactional messages, including password resets, email
verification, and form notifications.

Source: [Cloudflare Email Sending setup](https://developers.cloudflare.com/email-service/get-started/send-emails/)

## Environment

The adapter requires a Cloudflare Email Service binding. It does not read environment variables,
API tokens, or account IDs.

The binding name must match the value passed to the adapter:

```jsonc
{
  "send_email": [
    {
      "name": "EMAIL",
      "allowed_sender_addresses": ["noreply@example.com"],
    },
  ],
}
```

For local development, proxy the binding to Cloudflare:

```jsonc
{
  "send_email": [
    {
      "name": "EMAIL",
      "remote": true,
      "allowed_sender_addresses": ["noreply@example.com"],
    },
  ],
}
```

Remote local bindings send real email. Use recipient addresses you control.

The sender domain must be enabled for Cloudflare Email Sending. When
`allowed_sender_addresses` is configured, Payload's `Email From` address and the adapter's
`defaultFromAddress` must be included in that list.

## What It Adds

- Payload Form Builder email delivery
- forgot-password email delivery
- email-verification delivery
- custom `payload.sendEmail()` delivery
- `to`, `cc`, `bcc`, `from`, and `replyTo`
- comma-separated recipient lists
- `Name <email@example.com>` address values
- HTML and plain-text email bodies
- a basic plain-text fallback when only HTML is provided
- attachments supplied as a string, `Buffer`, or Node.js `Readable`
- inline attachments using Nodemailer's `cid` field
- unchanged Cloudflare Email Service responses and preserved machine-readable error codes

The adapter does not add Payload collections, fields, endpoints, admin components, or database
schema.

## Configuration

```ts
// src/payload.config.ts
cloudflareEmailAdapter({
  binding: env.EMAIL,
  defaultFromAddress: 'noreply@example.com',
  defaultFromName: 'Example',
})
```

Options:

- `binding`: Cloudflare Email Service Workers binding from the runtime environment.
- `defaultFromAddress`: sender address used when Payload does not provide `from`.
- `defaultFromName`: sender name used with the default sender address.
- `maxMessageBytes`: adapter-side byte limit for the complete structured message payload. Defaults
  to 5 MiB; use 25 MiB only when every destination address is verified.

The package exports `CloudflareEmailBinding` for applications that do not directly use generated
Wrangler types:

```ts
import type { CloudflareEmailBinding } from 'payload-cloudflare-email-adapter'

type CloudflareRuntime = {
  env: {
    EMAIL: CloudflareEmailBinding
  }
}
```

### Error handling

The Workers binding rejects with an `Error` whose `code` is a machine-readable string such as
`E_RATE_LIMIT_EXCEEDED`; it is not an HTTP status. The adapter converts documented Cloudflare
errors to Payload `APIError` instances and preserves that string at `error.data.code`. Validation
and configuration errors map to `400`, oversized content to `413`, rate and daily limits to `429`,
delivery and internal service failures to `502`, and unknown Cloudflare codes to `500`. Errors
without a string `code` are rethrown unchanged.

### Attachments

Each attachment requires `filename`, `contentType`, and `content`. File-system and URL `path`
attachments are not supported; load their data into `content` first.

Strings with `encoding: 'base64'` are passed through unchanged, while other strings are encoded as
UTF-8. The adapter buffers Node.js `Readable` streams as `Uint8Array` values before sending the
message. While attachments are mapped, their aggregate content is capped at `maxMessageBytes` so
streams stop before consuming unbounded Worker memory. After the complete message object is built,
the adapter measures its serialized metadata and attachment buffers together and applies the same
limit to the entire payload. Cloudflare separately applies its authoritative
[complete-message limit](https://developers.cloudflare.com/email-service/platform/limits/#email-content-limits)
after MIME encoding and transport overhead are added.

## Development

Install dependencies and run the focused checks:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

Adapter source is in `src/`. Tests are in `tests/`.

The package's `prepack` lifecycle runs tests, type checking, linting, and the release build before
an npm tarball is created.

## Test in Another Project

For release validation, test the packed artifact instead of a live source-folder dependency:

```bash
pnpm pack
```

Then in the external Payload application:

```bash
pnpm add /path/payload-cloudflare-email-adapter-*.tgz
```
