type BrandLogoProps = {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const sizeClasses = {
  sm: 'h-9 w-9 p-1.5',
  md: 'h-11 w-11 p-1.5',
  lg: 'h-16 w-16 p-2',
};

export default function BrandLogo({ size = 'md', className = '' }: BrandLogoProps) {
  return (
    <div
      className={`${sizeClasses[size]} shrink-0 overflow-hidden rounded-full bg-white shadow-sm ring-1 ring-black/5 ${className}`}
      aria-label="Sparrow Official"
    >
      <img
        src="/sparrow-logo.svg"
        alt="Sparrow Official"
        className="h-full w-full object-contain"
      />
    </div>
  );
}
