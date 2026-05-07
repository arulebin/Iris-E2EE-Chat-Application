// Brief splash on initial load. Mirrors the Chatx Figma's intro screen.
export function Splash() {
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-8">
      <div className="relative">
        {/* Outer ring */}
        <div className="w-40 h-40 rounded-full border-[10px] border-primary flex items-center justify-center">
          <span className="text-primary font-extrabold text-3xl tracking-tight">Iris</span>
        </div>
        {/* Tail / paper plane shape */}
        <div className="absolute -bottom-3 -left-2 w-10 h-10 bg-primary rotate-45 rounded-tl-md" />
      </div>
      <p className="mt-12 text-primary font-semibold text-xl text-center">
        Stay connected with privacy
      </p>
    </div>
  );
}
