// The ten seeded help articles. Plain markdown, no em dashes.
export const HELP_ARTICLES = [
  {
    slug: 'connect-boulevard',
    title: 'Connecting Boulevard',
    tags: 'integrations,boulevard',
    body: `# Connecting Boulevard

1. In Boulevard, open Manage Business, then Integrations, then API.
2. Create an API key and copy your Business ID.
3. In your dashboard, open Data and Team, find the Boulevard card, and select Connect.
4. Paste the API key and Business ID, then select Test connection.
5. When the test passes, review the stage mapping (appointments map to Scheduled and Completed, paid line items map to Purchases) and save.

Boulevard syncs hourly. Use Sync now after connecting to backfill the current month.`,
  },
  {
    slug: 'connect-housecall-pro',
    title: 'Connecting Housecall Pro',
    tags: 'integrations,housecallpro',
    body: `# Connecting Housecall Pro

Housecall Pro requires the MAX plan (or an add on) for API access. Check your plan before starting.

1. In Housecall Pro, open Settings, then API access, and generate a token.
2. In your dashboard, open Data and Team, find the Housecall Pro card, and select Connect.
3. Paste the API key and select Test connection. The panel will tell you if your plan does not include API access.
4. Review the stage mapping: jobs created map to Jobs Booked, jobs completed to Jobs Completed, invoices paid to Invoices Paid.`,
  },
  {
    slug: 'connect-jobber',
    title: 'Connecting Jobber',
    tags: 'integrations,jobber',
    body: `# Connecting Jobber

Jobber uses OAuth: you sign in with your Jobber account and approve access. API access is available on Jobber's Connect and Grow plans.

1. Open Data and Team, find the Jobber card, and select Connect with Jobber.
2. Sign in and approve. You will return to the dashboard automatically.
3. Run Test connection, review the stage mapping, and save.

If the connection breaks (for example after a password change), the card turns red. Select Reconnect to repeat the OAuth flow.`,
  },
  {
    slug: 'install-tracking-script',
    title: 'Installing the tracking script',
    tags: 'tracking,pixel,website',
    body: `# Installing the tracking script

The tracking script records page views, form activity, and first touch attribution on your website.

1. Open Data and Team and find the Website Pixel source.
2. Copy the snippet. It looks like: \`<script async src="https://YOUR-DASHBOARD-DOMAIN/t.js"></script>\`
3. Paste it into the head of every page, or into your site template.

To capture form fields before submission, add \`data-lbi\` to the form tag. The script never captures passwords, card numbers, CVC codes, or SSN fields.`,
  },
  {
    slug: 'upload-csv',
    title: 'Uploading CSV files',
    tags: 'csv,imports',
    body: `# Uploading CSV files

Every source supports CSV upload as a fallback when a live connection is not available.

1. Export the month from the platform (Meta Ads Manager, Google Ads, GHL, or Boulevard).
2. Open Data and Team, find the source, and select Mark pulled, then Upload CSV.
3. Pick the month the file covers and upload.

Re uploading the same month replaces the previous rows completely, so the latest file always wins. After upload, the month recalculates automatically.`,
  },
  {
    slug: 'verify-sources',
    title: 'Verifying sources and the check icons',
    tags: 'sources,verification',
    body: `# Verifying sources

Every number on the dashboard carries a small check icon showing where its data stands:

- Gray: data imported but not yet verified by a person.
- Green: a teammate verified the data against the platform.
- Red: the data is older than the source's cadence (default 7 days) and needs a fresh pull.

Hover the icon to see the source, when records run through, and who verified. Select Verify after you have checked the numbers against the platform. A fresh import resets the icon to gray.`,
  },
  {
    slug: 'in-month-vs-cohort',
    title: 'Reading in month versus cohort numbers',
    tags: 'metrics,cohort',
    body: `# In month versus cohort

The dashboard shows two views of each month:

- In month: everything that happened inside the calendar month, regardless of when the lead arrived. This matches what the platforms report.
- Lead cohort: follows the leads created in the month forward through 30, 60, and 90 days, showing how that group converts over time.

A cohort window shows dashed styling while it is still maturing. The total column includes everything attributed to the cohort so far.`,
  },
  {
    slug: 'custom-domains',
    title: 'Setting up a custom domain',
    tags: 'whitelabel,domains',
    body: `# Custom domains

On the whitelabel plan you can serve the dashboard from your own domain, for example bi.yourcompany.com.

1. Open Settings inside Data and Team and enter the domain.
2. The screen shows a CNAME record and sometimes a TXT validation record. Add both at your DNS provider.
3. The status moves from pending validation to pending ssl to active. This usually completes within minutes of the DNS records landing.

Once active, the dashboard and login work on your domain automatically.`,
  },
  {
    slug: 'inviting-users',
    title: 'Inviting users and view configs',
    tags: 'team,users,permissions',
    body: `# Inviting users

Open Data and Team, then Team, and select Invite. Two roles exist inside your account:

- Admin: full control of branding, integrations, uploads, users, and targets.
- Viewer: read only access, limited by a view config.

A view config controls which tabs (Performance, Work Backwards, Planning), which months, and which channels a viewer sees. Present and Data and Team are never available to viewers. The temp password shows once at invite time, so copy it before closing the dialog.`,
  },
  {
    slug: 'targets-and-chat',
    title: 'Setting targets and using the assistant',
    tags: 'targets,chat,assistant',
    body: `# Targets and the assistant

Targets drive the Planning tab and the target comparison in the top bar. Set them per month in Data and Team, or ask the assistant.

The chat widget in the bottom right answers questions about your data and can make configuration changes for admins: updating targets, changing theme colors, inviting users, and verifying sources. Every change shows a before and after preview, asks you to confirm, and can be reverted with one click from the same conversation.`,
  },
];
