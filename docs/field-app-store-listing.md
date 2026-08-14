# All Star Field: store listings

Draft copy and the exact declarations both stores ask for. Everything here
matches what the app does; a declaration that does not match is what takes
an app down later rather than getting it questioned now.

This app is not for the public. It is a work tool that only All Star's reps
can sign into, and the copy says so plainly. That is deliberate: a member of
the public who installs it and finds a login wall is the person most likely
to leave a one star review.

---

## Apple App Store

**Name** (30 max): `All Star Field`

**Subtitle** (30 max): `Door to door logging`

**Promotional text** (170 max)

> For All Star field representatives. Log every door in seconds, with or
> without a signal, and see what your team already knows about the street
> you are standing on.

**Description**

> All Star Field is the app All Star's representatives use at the door.
>
> This is a work app. You need an account from your manager to use it.
>
> **Log a knock in seconds.** Big outcome buttons you can hit with one
> thumb, in the sun, while walking. The address stays put between doors on
> the same street, so most knocks are one tap.
>
> **Works with no signal.** Every knock is saved on your phone the moment
> you log it and sent when a connection comes back. Basements, dead zones
> and a dead battery in the middle of a shift do not cost you a door. You
> never wait on a loading spinner at somebody's porch.
>
> **Know the street before you knock it.** See what the team already found
> at the doors around you, including any household that asked not to be
> knocked again.
>
> **See your own numbers.** Your knocks, conversations, appointments and
> sales, today and over the week. Managers see the team's.
>
> Location is optional and used only while the app is open. You can log
> every knock by typing the address instead.

**Keywords** (100 max)

> door,knocking,field,sales,canvassing,route,rep,knocks,d2d,leads

**Category**: Business. Secondary: Productivity.

**Age rating**: 4+. No objectionable content of any kind.

**Support URL** and **Marketing URL**: TODO, a LetLois or All Star page.

**Privacy policy URL**: the hosted `docs/field-app-privacy.md`.

### App Review Information

Fill this in or the app is rejected without being opened.

- **Sign in required:** yes.
- **Demo account:** a real, active rep on All Star's roster, created in Data
  and Team. Leave it active for the whole review.
- **Notes:**

> This is an internal work app for All Star's door to door representatives.
> Accounts are created by a manager in the company's own dashboard; there is
> no public sign up, which is why a demo account is provided.
>
> It is not a wrapped website. Every knock is written to the phone first and
> uploaded later, so the app is fully usable with no connection, and it uses
> device location to identify which doors on a street have already been
> worked.
>
> Location is requested only when the representative taps for it, only while
> the app is in use, and the app is fully functional if it is declined.
> There is no background location.
>
> Accounts are created and deleted by the company's own managers rather than
> by the representative, since they are employment records. A representative
> who wants theirs removed asks their manager or writes to the support
> address in the listing.

### Privacy nutrition labels

| Data | Collected | Linked to the user | Used for tracking | Purpose |
| --- | --- | --- | --- | --- |
| Name | Yes | Yes | No | App functionality |
| Email address | Yes | Yes | No | App functionality |
| Phone number | Yes | Yes | No | App functionality |
| Precise location | Yes | Yes | No | App functionality |
| Other user content (knock notes, outcomes, addresses) | Yes | Yes | No | App functionality |

- **Tracking:** none. No ATT prompt is needed and none is shown.
- **Third party analytics or advertising SDKs:** none.

The contact details of people met at the door are collected under Name,
Email address and Phone number above. They are entered by the
representative, not read from the device's contacts.

---

## Google Play

**App name** (30 max): `All Star Field`

**Short description** (80 max)

> Log every door in seconds, online or off. For All Star field reps.

**Full description**: the App Store description above works as is.

**Category**: Business. **Tags:** productivity, work.

**Content rating**: complete the questionnaire; expect Everyone. Nothing in
the app is user generated content shown to other users outside the company.

### Data safety

| Data type | Collected | Shared | Optional | Purpose |
| --- | --- | --- | --- | --- |
| Name | Yes | No | No | App functionality |
| Email address | Yes | No | No | App functionality, Account management |
| Phone number | Yes | No | No | App functionality |
| Approximate location | Yes | No | **Yes** | App functionality |
| Precise location | Yes | No | **Yes** | App functionality |
| Other user generated content | Yes | No | No | App functionality |

- **Encrypted in transit:** yes, HTTPS throughout.
- **Users can request deletion:** yes, through their manager or the support
  address. Give the support URL when asked.
- **Data shared with third parties:** none.
- **Independent security review:** no.

### Permission declarations

Play asks about location specifically.

> Location is attached to a logged visit so the team can see which addresses
> on a street have been worked and can be warned before knocking a household
> that asked not to be contacted again. It is requested only while the app is
> in use, only when the representative taps to use it, and the app is fully
> functional if it is declined. The app does not request background
> location.

---

## Screenshots

Both stores want them, and they have to come from a real device or a
simulator, which means the app has to be running first.

Take these four, in this order. They are the four things a rep would want to
see before installing, and they are also the four that answer a reviewer's
questions without them having to ask.

1. **The knock form** with an address filled in and the outcome buttons
   visible. This is the app.
2. **The sync pill reading "3 saved on phone"**, which shows the offline
   story in one glance.
3. **Doors near you**, with a "Do not knock" row visible.
4. **The Me screen** with a week of numbers.

Sizes: iOS needs 6.7 inch and 6.5 inch sets, Play needs at least two phone
screenshots plus a 1024x500 feature graphic.

Use the sample data if a real rep's numbers are not suitable for a public
listing, and remember that seeded rows are flagged as sample data in the
dashboard. Do not put a real household's name, address or phone number in a
store screenshot.
