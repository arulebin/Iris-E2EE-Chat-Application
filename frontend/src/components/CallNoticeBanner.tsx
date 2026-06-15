type Props = {
  message: string;
};

export function CallNoticeBanner({ message }: Props) {
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-primary text-white px-4 py-2 rounded-lg shadow-lg z-40 text-sm font-semibold">
      {message}
    </div>
  );
}
