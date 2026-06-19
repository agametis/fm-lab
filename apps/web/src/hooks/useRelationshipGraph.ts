import { API_BASE } from '../config/apiBase';
import { useEffect, useState } from 'react';

export type TOField = {
  uuid: string;
  id: number;
  name: string;
  type: string;
  dataType: string;
  isUsedInRelation: boolean;
};

export type TableOccurrence = {
  uuid: string;
  id: number;
  name: string;
  type: string;
  baseTable: { name: string; uuid: string } | null;
  dataSource: { name: string; uuid: string } | null;
  view: 'Full' | 'Related' | 'Collapse';
  bounds: { top: number; left: number; bottom: number; right: number };
  height: number | null;
  color: { r: number; g: number; b: number; a: number } | null;
  fields: TOField[];
};

export type JoinPredicate = {
  operator: string;
  symbol: string;
  leftFieldUuid: string;
  leftFieldName: string;
  rightFieldUuid: string;
  rightFieldName: string;
};

export type Relationship = {
  id: number;
  left: { toUuid: string; toName: string; cascadeCreate: boolean; cascadeDelete: boolean };
  right: { toUuid: string; toName: string; cascadeCreate: boolean; cascadeDelete: boolean };
  predicates: JoinPredicate[];
};

export type RelationshipGraphData = {
  file: string;
  viewport: { minX: number; minY: number; maxX: number; maxY: number };
  tableOccurrences: TableOccurrence[];
  relationships: Relationship[];
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error?: { message: string };
};

const baseUrl = (API_BASE) + '/api';

export function useRelationshipGraph(fileName: string | null | undefined) {
  const [data, setData] = useState<RelationshipGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fileName) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`${baseUrl}/relationship-graph/${encodeURIComponent(fileName)}`)
      .then(async r => {
        const json: ApiEnvelope<RelationshipGraphData> = await r.json();
        if (!r.ok || !json.success) {
          throw new Error(json.error?.message || `HTTP ${r.status}`);
        }
        return json.data;
      })
      .then(d => {
        if (!cancelled) setData(d);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fileName]);

  return { data, loading, error };
}
