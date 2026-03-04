export function isGuestMode() {
  return process.env.GUEST_MODE === "true";
}

export function hasClerkEnv() {
  return (
    !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY &&
    !!process.env.CLERK_SECRET_KEY
  );
}

export async function getClerkUserId(): Promise<string | null> {
  if (isGuestMode() || !hasClerkEnv()) {
    return null;
  }

  const { auth } = await import("@clerk/nextjs/server");
  return auth().userId ?? null;
}

export async function getCurrentClerkUser() {
  if (isGuestMode() || !hasClerkEnv()) {
    return null;
  }

  const { currentUser } = await import("@clerk/nextjs/server");
  return currentUser();
}
