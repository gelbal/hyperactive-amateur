# PRODUCT.md — Amateur Hyperactive

> Quick draft from `spec.md`, `spec-v1.1.md`, and `README.md`. Edit freely.

## Register

**Product.** This is an interactive creative tool, a single-page web app where the UI exists to serve the user's making-a-thing flow. It's not a marketing surface; there is no separate homepage, blog, or pricing page. The whole app lives at `/`.

## Users & Purpose

Hobbyists, music nerds, beat-curious content creators. Someone who saw Lasse Gjertsen's "Hyperactive" / "Amateur" videos and thought *I want to do that without spending a weekend in Premiere*. Desktop only, single-session creative bursts (10-40 min from sit-down to "this is fun, let me record it").

Job to be done: record 8 short audio+video clips of yourself, sequence them on an 8-track 16-step grid, hit play, watch a hard-cut hip-hop video of yourself perform. Export to WebM and share.

The app collapses what was historically a 100-clip video-editing workflow into a step sequencer plus a viewport that hard-cuts in time with the audio. Speed-of-expression is the primary design value. If a control would take a beginner more than 2 seconds to understand, it should be cut, hidden, or auto-set.

## Brand personality

Playful. Lo-fi. Hip-hop-tinted. Closer to a hobbyist instrument like an MPC than a SaaS dashboard. The name "Amateur Hyperactive" itself is anti-corporate, it celebrates the amateurish, the hyperactive, the chopped-up aesthetic.

Three adjectives the UI should evoke: **scrappy, immediate, musical**.

Not the brand: clean, professional, neutral, calm.

Visually right now: dark zinc-950 surface, orange-500 accent (sample-pad orange, MPC-coded), white tabular numerics, very little chrome, lots of empty space.

## Anti-references

What this app should NOT look like:

- **SaaS dashboards** (Linear, Vercel, Stripe-dashboard). Too clean, too gray, too corporate. Wrong audience.
- **Adobe / DAW pro tools** (Audition, Ableton, Pro Tools). Too dense, too intimidating, too many knobs. The user is here to play, not to mix.
- **Incredibox.** Close cousin in functionality, but its aesthetic is round, cute, family-friendly. Amateur Hyperactive is sharper, lo-fi, more "kid in a basement with a webcam" than "browser-game for kids."
- **Generic AI SaaS** (the gradient-on-dark-glassmorphism aesthetic, the hero metric, the AI-purple). The fact that we use AI under the hood should never leak into the visual treatment.

## Strategic design principles

1. **The viewport is the hero.** The 480×480 canvas where the hard-cut video plays is the emotional center of the app. Everything else exists to feed it. Visually, the eye should be drawn there.
2. **The grid is the instrument.** The 8×16 step grid is the interaction surface. It should feel responsive, percussive, immediate. The playhead sweep, the cell-click, the active-step ring all need to feel alive.
3. **No mode is the default mode.** No tutorial, no guided tour, no first-run modal. The empty state is the tutorial: see a viewport, see a grid, see a record button on T1. The next move is obvious.
4. **AI is a button, not a presence.** The Suggest / variations / auto-tag features are help, not a chat. Never a chatbot, never a sidebar, never a "talk to your beat" feature.
5. **Cuts are music.** The visual cut rate is a musical decision, not a graphical one. The same logic governs both audio and video; they're locked.

## Accessibility

Desktop Chrome / Edge ≥120. Safari unsupported. Mobile out of scope, this is a hands-on-keyboard creative tool. Focus order should follow reading order; spacebar plays/stops outside text inputs; numeric inputs respect arrow keys and scroll-wheel.

Color contrast: orange-500 on zinc-950 passes AA at the sizes used. Status colors (red for error, orange for active, zinc for inactive) should not be the only differentiator, paired with iconography or labels where it matters.

## v2 / not-yet

Things deliberately deferred:

- Mobile / PWA
- Multiple named projects
- Sampler / pitch-shifted melody mode
- Arrangement / song-structure mode (chain multiple patterns)
- Free-text tags beyond the 5 categories

Don't design for these now; design for the v1.1 surface as it exists.
