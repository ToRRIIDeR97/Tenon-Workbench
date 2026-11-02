/** Inline new-session content width — keep in sync with session composer `placement === "inline"`. */
// Grows with the window (the view is an inline-size container): 640px on small windows up to 960px on wide ones,
// never wider than 92% of the view.
export const NEW_SESSION_CONTENT_WIDTH = "w-[min(92cqw,clamp(640px,calc(40cqw+240px),960px))] px-0"
