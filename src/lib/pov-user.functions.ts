import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { fetchPovUser } from "@/lib/pov.server";

export const lookupPovUser = createServerFn({ method: "GET" })
  .inputValidator((data) => z.object({ wallet: z.string().min(4) }).parse(data))
  .handler(async ({ data }) => {
    try {
      const user = await fetchPovUser(data.wallet);
      return { wallet: data.wallet, user };
    } catch {
      return { wallet: data.wallet, user: null };
    }
  });
