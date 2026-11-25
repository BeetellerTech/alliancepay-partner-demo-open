"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <div className="empty"><h1>Não foi possível carregar esta tela</h1><p>Suas tentativas foram preservadas. Recarregue a tela para consultar o estado atual.</p><button className="button primary" onClick={reset}>Tentar carregar novamente</button></div>; }
