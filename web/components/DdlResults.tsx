import type React from "react";
import type { DdlItem, ViewMode } from "../types";
import { DdlCard } from "./DdlCard";
import { DdlTable } from "./DdlTable";

export function DdlResults({
  applicationSourceKeys,
  favorites,
  highlightedKey,
  items,
  onAddApplication,
  onOpenApplication,
  onToggleFavorite,
  onToggleRead,
  readItems,
  viewMode
}: {
  applicationSourceKeys: Set<string>;
  favorites: Set<string>;
  highlightedKey: string | null;
  items: DdlItem[];
  onAddApplication: (item: DdlItem) => void;
  onOpenApplication: (item: DdlItem) => void;
  onToggleFavorite: (key: string) => void;
  onToggleRead: (key: string) => void;
  readItems: Set<string>;
  viewMode: ViewMode;
}): React.ReactElement {
  if (viewMode === "table") {
    return (
      <DdlTable
        favorites={favorites}
        highlightedKey={highlightedKey}
        items={items}
        applicationSourceKeys={applicationSourceKeys}
        onAddApplication={onAddApplication}
        onOpenApplication={onOpenApplication}
        onToggleFavorite={onToggleFavorite}
        onToggleRead={onToggleRead}
        readItems={readItems}
      />
    );
  }
  return (
    <ol className="notice-list">
      {items.map((item) => (
        <DdlCard
          addedToApplications={applicationSourceKeys.has(item.key)}
          favorite={favorites.has(item.key)}
          highlighted={item.key === highlightedKey}
          item={item}
          key={item.key}
          onAddApplication={onAddApplication}
          onOpenApplication={onOpenApplication}
          onToggleFavorite={onToggleFavorite}
          onToggleRead={onToggleRead}
          read={readItems.has(item.key)}
        />
      ))}
    </ol>
  );
}
