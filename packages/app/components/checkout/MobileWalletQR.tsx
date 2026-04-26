"use client";
export function MobileWalletQR({ url, onBack }: { url: string; onBack: () => void }) {
  return (
    <div className="text-center py-6">
      <p>QR rendering — Task 5 fills this.</p>
      <button onClick={onBack} className="btn-cb-pill-light mt-4">Back</button>
    </div>
  );
}
