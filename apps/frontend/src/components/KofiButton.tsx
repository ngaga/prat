"use client";

const KOFI_USERNAME = process.env.NEXT_PUBLIC_KOFI_USERNAME ?? "YOUR_KOFI_USERNAME";

export function KofiButton() {
  return (
    <a
      href={`https://ko-fi.com/${KOFI_USERNAME}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-lg bg-[#ff5e5b] px-4 py-2 text-white transition hover:bg-[#ff4440]"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="currentColor"
      >
        <path d="M23.881 8.948c-.773-4.085-4.859-4.593-4.859-4.593H.723c-.604 0-.679.798-.679.798s-.082 7.324-.022 11.822c.164 2.424 2.586 2.672 2.586 2.672s8.267-.023 11.966-.049c2.438-.426 2.683-2.566 2.658-3.734 4.352.24 7.422-2.028 7.457-5.322.047-3.133-2.024-5.467-6.128-5.795z" />
      </svg>
      Buy me a coffee
    </a>
  );
}
