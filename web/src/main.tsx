import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/opsz.css";
import "@fontsource-variable/jetbrains-mono";
import { App } from "./App";
import { ConfirmProvider } from "./components/Modal";
import { toast, Toaster } from "./components/Toast";
import "./styles.css";

const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 } },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (!mutation.meta?.silent) toast.error((mutation.meta?.error as string) ?? "Request failed", error.message);
    },
  }),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <App />
        <Toaster />
      </ConfirmProvider>
    </QueryClientProvider>
  </StrictMode>,
);
