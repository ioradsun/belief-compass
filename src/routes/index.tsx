import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/conviction/AppShell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Conviction — a perpetual belief market" },
      {
        name: "description",
        content:
          "Put real capital behind what you believe. See who believes what you believe, who disagrees, and what is changing.",
      },
      { property: "og:title", content: "Conviction — a perpetual belief market" },
      {
        property: "og:description",
        content:
          "Put real capital behind what you believe. See who believes what you believe, who disagrees, and what is changing.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return <AppShell />;
}
