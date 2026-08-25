'use client';
import ChatWorkspace from '@/components/ChatWorkspace';

export default function ChatThreadPage({ params }: { params: { id: string } }) {
  return <ChatWorkspace key={params.id} conversationId={params.id} />;
}
