import { createMvttAuthClient } from "@vtt/auth/client";

// Same-origin in production (substrate serves /api/auth/*); in dev, Vite
// proxies /api/auth/* to the substrate server. Either way, a relative base.
export const authClient = createMvttAuthClient();
