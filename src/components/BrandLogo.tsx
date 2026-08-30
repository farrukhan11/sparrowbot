type BrandLogoProps = {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const sizeClasses = {
  sm: 'h-10 w-10 rounded-lg bg-white p-1 shadow-sm',
  md: 'h-14 w-14',
  lg: 'h-24 w-24',
};

export default function BrandLogo({ size = 'md', className = '' }: BrandLogoProps) {
  return (
    <div
      className={`${sizeClasses[size]} shrink-0 ${className}`}
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
