import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/generate(.*)",
  "/video/(.*)",
  "/api/videos(.*)",
  "/api/upload(.*)",
]);

const hasClerkEnv =
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;
const guestMode = process.env.GUEST_MODE === "true";

const middleware = hasClerkEnv && !guestMode
  ? clerkMiddleware((auth, req) => {
      if (isProtectedRoute(req)) {
        auth().protect();
      }
    })
  : () => {
    return NextResponse.next();
    };

export default middleware;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
