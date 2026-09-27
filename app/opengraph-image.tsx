import { ImageResponse } from "next/og";

import { SOCIAL_CARD_ALT, SOCIAL_CARD_SIZE, SocialCard } from "@/features/landing/social-card";

export const alt = SOCIAL_CARD_ALT;
export const size = SOCIAL_CARD_SIZE;
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(<SocialCard />, { ...size });
}
