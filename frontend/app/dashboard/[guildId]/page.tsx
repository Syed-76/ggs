import Dashboard from "./dashboard";
export default async function Page({ params }: { params: Promise<{ guildId: string }> }) { const { guildId } = await params; return <Dashboard guildId={guildId} />; }
