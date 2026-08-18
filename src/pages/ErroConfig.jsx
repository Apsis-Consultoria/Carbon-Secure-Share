import { TriangleAlert } from 'lucide-react';

/**
 * ErroConfig - falta VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY.
 *
 * Existe para cumprir a regra "nunca tela branca": sem ela, cada chamada
 * falharia com "failed to fetch" e a pessoa ficaria olhando para um retângulo
 * vazio sem saber se o problema é a internet dela.
 *
 * O texto é para o CLIENTE, não para quem faz o deploy: ele não tem como
 * consertar isso e não deveria ler nome de variável de ambiente. O detalhe
 * técnico vai para o console, que é onde quem opera vai procurar.
 */
export default function ErroConfig() {
  if (typeof console !== 'undefined') {
    console.error(
      '[Secure Share Carbon] VITE_SUPABASE_URL e/ou VITE_SUPABASE_ANON_KEY ausentes ' +
        'ou ainda com o valor de exemplo. Preencha o .env (dev) ou as variáveis de ' +
        'ambiente do Amplify (produção) e refaça o build.',
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4F6F4] px-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-[#DDE3DE] p-8 text-center">
        <div className="w-12 h-12 rounded-full bg-[#FDF3E3] border border-[#F2DDB4] flex items-center justify-center mx-auto mb-4">
          <TriangleAlert size={22} className="text-[#8A5A12]" />
        </div>

        <h1 className="font-semibold text-[#1A2B1F] text-lg">
          Sistema temporariamente indisponível
        </h1>

        <p className="text-sm text-[#5C7060] mt-2 leading-relaxed">
          O Secure Share não conseguiu iniciar por um problema de configuração do
          servidor. Não é nada do seu lado, e recarregar a página não resolve.
        </p>

        <p className="text-sm text-[#5C7060] mt-3 leading-relaxed">
          Avise a pessoa da APSIS que compartilhou os documentos com você.
        </p>
      </div>
    </div>
  );
}
