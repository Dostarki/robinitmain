# Robinity Intelligence — Shared Site Design System

## Brand and footer update — September 18, 2026

- Public interface name: Robinity Intelligence. Keep English UI copy brief; retain evidence, risk findings and truthful availability states.
- Site branding does not rename existing on-chain token metadata, saved launch names, transaction logs or third-party token names. Legacy storage keys and scoring version identifiers remain compatible.
- Landing footer replaces duplicate section navigation with the official X profile, copyright, Terms of Use, Privacy and Risk Disclosure. X destination: https://x.com/robinityint.
- Footer structure references: [Chainlink](https://chain.link/) and [Arbitrum](https://arbitrum.io/). Their legal wording is not copied.
- Notices live in `app/legal.html`; layouts in `app/brand-layout.css`. Before public launch, obtain legal review and supply the actual operator identity, privacy contact, applicable jurisdiction and retention policy. The current notices describe the implemented local service; they do not certify legal compliance.
- Existing authenticator enrollments are not reset; the renamed issuer applies only to future enrollment QR codes.

## 1. Brand direction

Intelligence logo effects: the welcome emblem has an 8-second perspective float, soft blue glow and a 7-second masked blue/apricot sheen. Its orbit and ambient aura are more visible. The background mask uses 7.5% opacity (5.5% mobile), a 16-second drift, a 20-second orbit and a faint 12-second sheen; loading raises opacity to 10% (8% mobile). Decorative layers are pointer-inert and remain behind all chat content. Reduced-motion stops movement and hides the animated sheen. CSS asset URLs remain external to the frontend build so the original shared PNG is reused without duplicating it into the bundle.

The supplied transparent mask logo lives at `app/assets/robinity-logo.png`, unchanged from the source image. All five pages use it as their favicon and header/sidebar mark. Intelligence also uses it as the welcome emblem, assistant mark and a pointer-inert, low-opacity background watermark. Background motion uses slow transform-only drift/orbit, with a slightly stronger presence while analysis is loading; reduced-motion disables movement. Mobile watermark opacity is lower to preserve text contrast. The logo is never used to replace a third-party token's icon.

Robinity Intelligence is a token-intelligence platform with a transparent token launch experience. The visual direction is **quiet precision**: charcoal surfaces, misty blue signals, soft apricot actions, substantial typography, and clear evidence. The brand should feel like professional financial software, not a neon trading terminal or an animated meme-token template.

The shared implementation lives in `app/site-theme.css`. It defines the canonical `--ds-*` interface and opt-in `.ds-*` primitives. Each page keeps its own layout and interaction code. Do not replace wallet authentication, scoring, provider logic, launch records, or contract behavior as part of a visual refresh.

## 2. Palette and roles

| Token | Value | Role |
| --- | --- | --- |
| `--ds-bg` | `#14171b` | Main canvas; neutral charcoal, not a blue-tinted black |
| `--ds-surface` | `#1e2329` | Default cards, sidebar, form containers |
| `--ds-surface-raised` | `#282e36` | Elevated panels and selected surfaces |
| `--ds-surface-hover` | `#303843` | Hover treatment, never a full section fill |
| `--ds-line` | `#343c46` | Dividers and subtle panel borders |
| `--ds-line-strong` | `#505e6b` | Input boundaries and stronger separation |
| `--ds-text` | `#e8e5df` | Main text on dark surfaces |
| `--ds-muted` | `#a2a6ad` | Secondary text, timestamps, descriptions |
| `--ds-blue` | `#8faac4` | Chart line, active navigation, informational accent |
| `--ds-blue-light` | `#b2c4d5` | Readable small links and labels on dark backgrounds |
| `--ds-orange` | `#dca782` | Primary action, key numeric emphasis |
| `--ds-orange-light` | `#e7bda0` | Primary-action hover |
| `--ds-paper` | `#f0eeea` | Optional contained light editorial surface |
| `--ds-ink` | `#202226` | Text on paper and orange buttons |
| `--ds-ink-muted` | `#666c73` | Secondary text on paper |
| `--ds-success` | `#8eb59d` | Safety scores and genuinely positive states only |
| `--ds-warning` | `#cbb17b` | Caution and uncertain evidence only |
| `--ds-danger` | `#c88686` | Negative safety signals and destructive states only |

The palette is intentionally muted: charcoal `#14171B`, slate cards `#1E2329`, misty blue `#8FAAC4`, soft apricot `#DCA782`, and warm off-white `#E8E5DF`. Avoid electric blue, neon orange, and bright colored halos. 3D materials should feel matte rather than emissive. Soft color variants use 10% opacity. Background gradients should remain faint: approximately 9% blue and 3.5% orange in localized radial fields. Neither color should tint every paragraph, entire screen, or all controls. Do not use purple, mint, bright cyan, or magenta as brand colors.

Blue means *information or selection*. Orange means *the next action*. Green never means the token is guaranteed safe; it only reflects the visible score/status category. Keep warning and danger distinctions intact even when the surrounding brand changes.

Avoid white text on orange buttons: use dark ink. On light editorial surfaces use dark ink for body text and a darker local blue for text links; the dark-theme accent itself is not a universal text color. Verify final computed contrast rather than assuming a translucent background makes text readable.

## 3. Typography

- UI and prose: `--ds-font-sans`, Manrope with system fallback. Pages may load the existing Google Fonts stylesheet, but remain legible without it.
- Numeric data, contract addresses, timestamps: `--ds-font-mono`, DM Mono with native monospace fallback. Use tabular numbers for changing amounts.
- Landing H1: responsive 44–76px, 1.02–1.08 line height, weight 600–700, no more than two or three short lines. Use restrained negative tracking, approximately `-.045em`; avoid crushed letters and oversized 100px typography.
- Section heading: responsive 30–46px, weight 600–700, approximately `-.035em` tracking.
- Card heading: 17–24px. Body copy: 14–17px with 1.55–1.7 line height. Supporting metadata: 12–13px. Tiny uppercase labels: 10–11px and limited to short labels.
- Long explanations should stay within 60–72 characters per line. Never make the whole interface uppercase monospace.
- Use one visibly dominant metric per card. Captions and secondary values should support it, not compete.

## 4. Layout, spacing, and surfaces

The primary content container is 1200px. Desktop gutters are 24px per side; mobile gutters are 16px. The spacing scale is 4, 8, 12, 16, 24, 32, 48, 64, and 96px, exported as `--ds-space-1` through `--ds-space-9`.

Cards use 24–32px desktop padding and 18–24px mobile padding. Inner rows use 12–16px gaps, cards use 16–24px gaps, and major landing sections use 72–112px vertical separation. Application panels can be denser but must maintain consistent label/input/status spacing.

Use radii deliberately: 12px for controls and compact cards, 18px for standard panels, and 24px for hero/product containers. Pills are reserved for navigation and compact status badges. Avoid a different radius for every component. Default borders are 1px. Shadows are restrained and help separation, not giant colored halos.

Decorative backgrounds must sit behind an uninterrupted reading surface. Use a subtle technical grid, restrained orbital/particle geometry, or soft light fields. Do not introduce full-screen saturated wireframes or several overlapping glowing gradients. Charts must remain more visually important than decorative effects.

## 5. Shared primitives

The stylesheet provides `.ds-container`, `.ds-surface`, `.ds-surface-raised`, `.ds-kicker`, `.ds-muted`, `.ds-mono`, `.ds-pill`, `.ds-button`, `.ds-button-secondary`, `.ds-button-danger`, `.ds-control`, `.ds-link`, `.ds-focusable`, `.ds-status`, and `.ds-sr-only`.

These are opt-in primitives. They do not globally override `body`, headings, buttons, page grids, or existing IDs. Pages map legacy local variables to the canonical tokens where that preserves functionality. The shared file must load before the page's final overrides; React can import it before its page-level stylesheet.

Primary buttons use orange with dark ink. Secondary actions use a raised navy surface, text, and a visible border. Destructive actions use a separate red treatment and explicit verbs. Buttons and inputs have at least 44px target height. Loading/disabled states retain descriptive text and cannot masquerade as successful completion.

## 6. Landing page

### Information order

1. Header with Robinity Intelligence identity and concise product navigation.
2. Hero containing the launch overview and purchase/commitment area. State the actual launch facts plainly; put the primary purchase action within the first screen on typical desktop viewports.
3. The Tape: concise transaction/activity context. Do not invent live transactions.
4. Interactive bonding curve: commitment inputs, current/selected curve position, received tokens, and cost metrics.
5. Token allocation overview and mechanics, with separate clearly defined anchor ranges.
6. Engagement Rewards as the final substantial section.
7. Minimal footer with appropriate destinations.

Preserve the existing business flow and working calculators; do not present a visual mock as a completed on-chain purchase. Any existing wallet or transaction feedback remains truthful. Chain labels must reflect actual configuration; branding is not evidence that a mainnet deployment exists.

### Visual hierarchy

Use a compact, calm header; generous but not empty hero spacing; a short proposition; a two-column product/commitment composition on desktop; and stacked cards on mobile. Prefer a clean numerical launch panel over oversized copy surrounded by decorative shapes. The curve should resemble credible financial software: subtle grid, blue line, orange selected point, readable axes, clear controls. The Tape should look like a structured activity ledger, not an endlessly flashing news ticker.

A translucent anchor navigator may stay fixed at top center after the header scrolls away. Give it a dependable near-black backdrop, visible border, and neutral readable text rather than trying to infer text color from changing backgrounds. Its active item is blue. Actual anchors and visible-section calculations must target distinct Curve, Mechanics, and Rewards sections. Account for sticky navigation height using scroll offsets. Avoid overlaps between mechanics and rewards that cause ambiguous selection.

### Established token facts

- Total supply: **1,000,000,000 Robinity Intelligence**.
- Presale/bonding allocation: **200,000,000 Robinity Intelligence** (20%).
- Full curve commitment target: **$100,000**.
- Published linear illustration: **$0.0001 → $0.0009 per Robinity Intelligence** across 200M tokens. The integrated total is 200M × the average price $0.0005 = $100,000. The price at a selected point is not the same as the average execution price for a purchase interval.
- Engagement Rewards: **50,000,000 Robinity Intelligence** (5%), distributed proportionally to eligible participants' points from promoting the project on X.
- Remaining allocation: **750,000,000 Robinity Intelligence** (75%). Its categories are not yet assigned. Leave them unassigned; do not invent treasury, liquidity, team, vesting, or burn claims.

Use live ETH/USD where the application already obtains it. Keep commitment input toggles and price freshness states functional. A X connection display must not imply a genuine OAuth connection or verified campaign scoring unless the backend supports it.

## 7. Risk intelligence page

Keep the single central analysis/composer experience with the token history rail on the left. History entries are compact token icons plus ticker; hover/focus can reveal score details. Selected entries use a subtle blue surface and border. Token logos keep fallback initials and do not break when unavailable.

Neutral surfaces dominate. Use blue for assistant identity, informational highlights, focus, and progress. Orange is reserved for submitting the analysis or the principal next action. Safety scores keep green/amber/red semantics; do not recolor risky findings to blue or orange just for brand consistency.

The report should have a clear asset header, headline score, warning summary, per-criterion breakdown, and creator/wallet evidence panels. Maintain unavailable/partial-data messages. Never turn missing data into a zero balance, zero historical launches, or a fabricated rug percentage. Creator identity and observed transaction coverage must remain qualified by evidence.

Keep progressive report reveal and typing, but avoid theatrical delays. Historical report selection should be quick. Decorative AI motion is subtle, low-opacity, and outside the main reading area. Do not loop bright animated patterns behind text.

## 8. Admin panel

Preserve wallet-plus-authenticator entry, server-side authorization, owner-only admin creation, deployment selections, per-network distinctions, and shared logs. A CSS change must not expose protected data or replace authorization with a hidden button.

Make the authenticated workspace look like an operational console: a clear top identity/navigation area; a network and selected-launch context strip; grouped deploy, curve, treasury, and testing controls; and a well-separated activity log. Preserve current element IDs, handlers, payloads, and status text.

Main actions use orange; selected network/launch uses blue. Sale/claim Open states use semantic green and Closed states use neutral muted text or caution where appropriate. Financial withdrawals and destructive operations use an explicit danger treatment, not a decorative orange CTA indistinguishable from harmless refresh.

Do not publish admin wallet addresses, secret keys, authenticator material, or provider credentials in design documentation or client markup. Existing addresses shown after authenticated access are operational data, not branding.

## 9. Local curve/testing page

Bring the diagnostic page into the same palette, typography, panel spacing, controls, and focus treatment without confusing it with the public landing. Preserve network labels, balances, purchase/claim actions, accounting rows, contract links, and transactional confirmations.

Use compact panels and monospaced operational values. Keep long addresses and log lines wrapping or horizontally contained; never widen the whole page. Mainnet/testnet state stays visible and accurate. Do not erase current state or records as part of theme application.

## 10. Motion and accessibility

Use 160ms interaction transitions and 260ms normal transitions with `--ds-ease`. A small hover lift of 1px is enough. Report sections can reveal with 8–12px vertical travel and gentle opacity easing. Scroll navigation should feel immediate, not like a long cinematic camera animation.

Honor `prefers-reduced-motion`: remove continuous motion, large parallax, typing delays, and sequential reveal delays. Content must remain visible when animations are disabled. Pause expensive decorative canvas rendering when offscreen or the document is hidden where practical.

Every interactive element needs a visible keyboard focus ring. Do not encode status using color alone: retain score numbers, labels, icons, and explanations. Give icon-only actions accessible names. Hover information must also be available on keyboard focus. Avoid low-opacity text on translucent glass. Maintain readable captions on mobile.

## 11. Responsive behavior

- Above 1100px: full desktop compositions with 1200px maximum width.
- 768–1100px: reduce card padding, rebalance columns, shorten metadata rows.
- Below 768px: stack marketing and operations grids; keep primary actions full-width where appropriate.
- Below 600px: history rail may become an explicit menu/drawer, but the opener, close/delete actions, and current token identity must remain reachable.
- Below 400px: allow navigation wrapping or intentional contained scrolling; never clip submit buttons or network selectors.

Use `min-width: 0` on grid/flex children carrying addresses and numbers. Use flexible column sizes, not fixed width cards. Tables may have their own scroll container. Test the page, not merely one component, for horizontal overflow.

## 12. Copy, integrity, and release checks

All public site copy remains English. Tone is concise, factual, and confident without guaranteed returns or safety claims. Explain Robinity Intelligence utility as token intelligence and transparent participation. Prefer “Analyze a token”, “View curve”, and “Engagement Rewards” over vague hype language.

Before shipping the visual refresh:

1. Confirm all four pages consume the shared tokens and no purple/green brand theme remains unintentionally.
2. Verify layout at desktop, tablet, and narrow mobile widths, including long token names and addresses.
3. Check anchor navigation, active section, wallet connection, commitment entry/toggle, and live ETH conversion.
4. Check authenticated admin controls, network/launch separation, existing records, and logs without making unsolicited blockchain transactions.
5. Check analysis submission, token history selection, logos/fallbacks, report reveal, missing-provider states, and semantic score colors.
6. Check keyboard focus, readable muted text, reduced motion, and basic contrast on dark and any light surfaces.
7. Build React assets, inspect runtime errors, and ensure provider keys and authentication secrets never appear in frontend output.

The shared template is a presentation system, not a change in financial model, security guarantees, API subscription terms, or contract permissions.

## 13. Refresh validation

- Shared-theme, duplicate-ID, local-stylesheet and JavaScript syntax checks: `node --experimental-vm-modules scripts/check-site-design.js`.
- Creator adapter regression suite: `node --test scripts/risk-creator.test.js` (8 tests passing).
- React risk assets rebuilt successfully.
- Browser review at 1280px desktop, 960px tablet and 390px mobile widths; reviewed pages have no horizontal document overflow.
- Curve / Mechanics / Rewards anchors and active-section states verified. Live ETH/USD data, USD entry and ETH conversion verified; $1,000 at the opening position allocates approximately 8.54M Robinity Intelligence, and a completed curve accepts no additional payment.
- Saved analysis selection, mobile history menu, token icons, command help and warning-score color verified.
- Admin login surface reviewed, with protected controls remaining hidden. Authenticated administration and blockchain signing were not exercised during this visual-only refresh.
- Existing backend credentials, contracts and stored application records were not reset or edited.

## 14. Landing dimensional layer

The landing uses a continuous low-contrast square grid: 64px cells on desktop and 48px on mobile. Blue lines and a few softly pulsing blue/orange cells add structure without covering text. Cards retain opaque dark surfaces for legibility.

The hero contains a local Three.js sculpture: a rotating 3×3×3 cube lattice, orange accent cubes, orbital paths, a perspective grid and sparse light particles. It is decorative, not a visualization of live sales or allocations. Its geometry has no financial meaning.

- Source: `app/landing-effects/src/scene.js`; styling: `app/landing-effects/effects.css`.
- Rebuild: `npm run build:landing`. The browser loads the bundled local asset; there is no runtime Three.js CDN or external 3D model/texture download.
- Rendering is capped at 30fps. Pixel ratio is capped at 1.5, or 1 on coarse-pointer devices; no shadows or bloom pipeline are used.
- The render loop pauses outside the viewport or when the document is hidden. Reduced-motion preferences switch to a static frame.
- WebGL failure/context loss reveals the CSS orbital fallback. All readable content and financial controls remain HTML/SVG and do not depend on WebGL.
- Cards enter without hiding their contents before JavaScript runs. Decorative layers do not intercept pointer events.

Dependency audit: no advisory was reported for the added Three.js dependency. The existing Solidity compiler dependency chain still has `solc`/`tmp` advisories (one low and one high); compiler upgrades are outside this visual change and must be separately verified against contract build/deployment behavior.
