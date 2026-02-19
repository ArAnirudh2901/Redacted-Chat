"use client"

import { useUsername } from "@/hooks/use-username";
import { client } from "@/lib/client";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";


export default function Home() {
  const router = useRouter()
  const { username } = useUsername()

  const { mutate: createRoom } = useMutation({
    mutationFn: async () => {
      // @ts-ignore - Eden Treaty type inference requires TypeScript generics
      const res = await client.room.create.post()

      if (res.status === 200) {
        router.push(`/room/${res.data?.roomId}`)
      }
    }
  })

  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-green-500">
            {">"}private_chat
            <p className="text-zinc-500 text-sm">A private, self-destructing chat room.</p>
          </h1>
        </div>
        <div className="border border-zinc-800 bg-zinc-900/50 p-6 backdrop-blur-md">
          <div className="space-y-5">
            <div className="space-y-2">
              <label className="flex items-center text-zinc-500">Your Identity</label>
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-zinc-950 border border-zinc-800 p-3 text-sm text-zinc-400 font-mono text-center">
                  {username}
                </div>
              </div>
            </div>
            <button onClick={() => createRoom()} className="w-full bg-zinc-300 text-black p-3 text-sm font-bold hover:bg-zinc-50 hover:text-black transition-colors mt-2 cursor-pointer disabled-opacity-50">
              Create a Secure Room
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
