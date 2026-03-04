"use client";

import Link from "next/link";
import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { NavbarShell } from "./navbar";

export function ClerkNavbar() {
  const { isSignedIn } = useUser();
  const signedIn = !!isSignedIn;

  return (
    <NavbarShell
      isSignedIn={signedIn}
      authControls={
        signedIn ? (
          <>
            <Button asChild size="sm">
              <Link href="/generate">Create Video</Link>
            </Button>
            <UserButton afterSignOutUrl="/" />
          </>
        ) : (
          <>
            <SignInButton mode="modal">
              <Button variant="ghost" size="sm">
                Sign In
              </Button>
            </SignInButton>
            <SignUpButton mode="modal">
              <Button size="sm">Get Started</Button>
            </SignUpButton>
          </>
        )
      }
    />
  );
}
