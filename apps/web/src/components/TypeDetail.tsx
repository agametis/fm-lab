import React from 'react';
import { ObjectDetail } from './ObjectDetail';
import type { LayoutCanvasHandle } from './LayoutCanvas';

interface TypeDetailProps {
  objectType: string;
  uuid: string;
  /**
   * Cross-Reference Highlight — UUIDs aller Back-Reference-Treffer im
   * aktuellen Container. Wird an die jeweilige View durchgereicht und dort
   * als matchUuids / highlightRefUuids konsumiert.
   */
  highlightUuids?: Set<string>;
  /**
   * Origin-Name als Fallback-Substring für Views ohne UUID-Match
   * (GenericObjectDetail, RelationshipGraph).
   */
  highlightText?: string | null;
  /**
   * Wird bei expliziter User-Interaktion in der View gefeuert (Suche, Filter).
   * Entfernt den ref-Param aus der URL.
   */
  onClearRef?: () => void;
  /**
   * Tatsächlich hervorgehobene Token-Vorkommen im jeweiligen Viewer — wird
   * für die RefOriginPill durchgereicht (siehe ObjectDetail).
   */
  onLiveMatchCount?: (count: number) => void;
  /**
   * Handle des eingebetteten LayoutCanvas (nur für objectType='Layout' belegt).
   * Wird von der DetailView in den ESC-Stack verdrahtet (Suche/Filter räumen).
   */
  layoutCanvasRef?: React.Ref<LayoutCanvasHandle>;
}

/**
 * Type Detail Router
 * Delegates to ObjectDetail which fetches type-specific details
 * via the /api/get-details endpoint (automatic template dispatch).
 */
export const TypeDetail: React.FC<TypeDetailProps> = ({
  objectType,
  uuid,
  highlightUuids,
  highlightText,
  onClearRef,
  onLiveMatchCount,
  layoutCanvasRef,
}) => {
  return (
    <ObjectDetail
      uuid={uuid}
      objectType={objectType}
      highlightUuids={highlightUuids}
      highlightText={highlightText}
      onClearRef={onClearRef}
      onLiveMatchCount={onLiveMatchCount}
      layoutCanvasRef={layoutCanvasRef}
    />
  );
};
