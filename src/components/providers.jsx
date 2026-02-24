"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"
import { RealtimeProvider } from "@upstash/realtime/client"
import { Toaster } from "sonner"
import { AuthProvider } from "@/hooks/use-auth"
import { Sidebar } from "@/components/sidebar"

export const Providers = ({ children }) => {
    const [queryClient] = useState(() => new QueryClient())

    return (
        <AuthProvider>
            <RealtimeProvider>
                <QueryClientProvider client={queryClient}>
                    <Sidebar />
                    {children}
                    <Toaster
                        theme="dark"
                        position="top-center"
                        toastOptions={{
                            style: {
                                background: '#1a0a0a',
                                border: '1px solid rgba(127, 29, 29, 0.6)',
                                color: '#ef4444',
                                fontFamily: 'var(--font-jetbrains-mono)',
                                fontSize: '13px',
                            },
                        }}
                    />
                </QueryClientProvider>
            </RealtimeProvider>
        </AuthProvider>
    )
}