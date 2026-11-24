import { createClient, createClientFromRequest, getAccessToken } from "@base44/sdk";
import { createMiddleware } from "@tanstack/react-start";
import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import { getAppParams } from "@/lib/app-params";

const createRequestClient = (request) => {
  if (request.headers.has("Base44-App-Id")) return createClientFromRequest(request);

  const { appId, appBaseUrl, functionsVersion } = getAppParams();
  if (!appId) throw new Error("VITE_BASE44_APP_ID must be set when the app is hosted outside Base44.");

  const authorization = request.headers.get("Authorization");
  if (authorization && !/^Bearer \S+$/i.test(authorization)) {
    throw new Error("Expected the Authorization header to contain a Bearer token.");
  }

  return createClient({
    appId,
    token: authorization?.slice("Bearer ".length),
    functionsVersion,
    appBaseUrl,
  });
};

// Keep the Base44 client lazy so handlers that don't use it work without platform headers.
const withGetBase44 = (next, request = getRequest()) => {
  let client;
  return next({ context: { getBase44: () => (client ??= createRequestClient(request)) } });
};

// Applied to every server function by src/start.js: sends the visitor's Base44
// access token with the call so `context.getBase44()` acts as the visitor (entity
// access rules apply). Anonymous visitors send nothing and get an anonymous client.
export const authMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    const token = typeof window === "undefined" ? null : getAccessToken();
    return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
  })
  .server(({ next }) => withGetBase44(next));

// Applied to every request by src/start.js, so a server route handler
// (`server.handlers`) receives the same `context.getBase44()` as a server function.
export const base44RequestMiddleware = createMiddleware({ type: "request" }).server(({ next, request }) =>
  withGetBase44(next, request),
);

// Only an auth rejection means "not signed in"; outages and rate limits propagate as themselves.
const currentUser = (context) =>
  context
    .getBase44()
    .auth.me()
    .catch((error) => {
      if (error?.status === 401 || error?.status === 403) return null;
      throw error;
    });

// Neither middleware authenticates anyone. Add this to a server function that
// needs a signed-in caller; it rejects anonymous callers and sets `context.user`:
//   createServerFn().middleware([requireUser]).handler(({ context }) => context.user.id)
export const requireUser = createMiddleware({ type: "function" }).server(async ({ next, context }) => {
  const user = await currentUser(context);
  if (!user) {
    setResponseStatus(401);
    throw Object.assign(new Error("Unauthorized"), { status: 401, code: "UNAUTHORIZED" });
  }
  return next({ context: { user } });
});

// The same for a server route: `server: { middleware: [requireUserRoute], handlers }` answers
// anonymous callers with 401 and sets `context.user`. Only on src/routes/api/* files: a route's
// middleware also runs for every route under it, and page navigations carry no token.
export const requireUserRoute = createMiddleware({ type: "request" }).server(async ({ next, context }) => {
  const user = await currentUser(context);
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return next({ context: { user } });
});
