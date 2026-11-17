import {
  Blocks,
  Cpu,
  Crosshair,
  Film,
  Radio,
  Smartphone,
  Swords,
  Trophy,
  Users,
  Youtube,
  Award,
  Sparkles,
  Crown,
} from 'lucide-react';

export const CATEGORY_ICON_OPTIONS = [
  'Trophy',
  'Film',
  'Radio',
  'Smartphone',
  'Blocks',
  'Swords',
  'Users',
  'Youtube',
  'Crosshair',
  'Cpu',
  'Award',
  'Crown',
];

export function CategoryIcon({
  iconName,
  iconUrl,
  className = 'h-5 w-5',
  alt = 'Category icon',
}: {
  iconName?: string | null;
  iconUrl?: string | null;
  className?: string;
  alt?: string;
}) {
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt={alt}
        referrerPolicy="no-referrer"
        className={`${className} rounded object-cover`}
      />
    );
  }

  switch (iconName) {
    case 'Film':
      return <Film className={className} />;
    case 'Radio':
      return <Radio className={className} />;
    case 'Smartphone':
      return <Smartphone className={className} />;
    case 'Blocks':
      return <Blocks className={className} />;
    case 'Swords':
      return <Swords className={className} />;
    case 'Users':
      return <Users className={className} />;
    case 'Youtube':
      return <Youtube className={className} />;
    case 'Crosshair':
      return <Crosshair className={className} />;
    case 'Cpu':
      return <Cpu className={className} />;
    case 'Award':
      return <Award className={className} />;
    case 'Crown':
      return <Crown className={className} />;
    case 'Sparkles':
      return <Sparkles className={className} />;
    default:
      return <Trophy className={className} />;
  }
}
