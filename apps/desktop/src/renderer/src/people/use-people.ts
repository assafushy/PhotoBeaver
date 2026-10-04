import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePbEvent } from '../lib/use-pb-event';

export const PEOPLE_KEY = ['people'] as const;

/**
 * Faces as a URL to their 256 px crop.
 *
 * @param faceId - Face id.
 * @returns The `pb-media://face/...` URL.
 */
export const faceUrl = (faceId: string): string => `pb-media://face/${faceId}`;

function useRefreshPeople(): () => void {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: PEOPLE_KEY });
    void client.invalidateQueries({ queryKey: ['person-faces'] });
    void client.invalidateQueries({ queryKey: ['facets'] });
    void client.invalidateQueries({ queryKey: ['asset'] });
  };
}

/**
 * Everyone found in the library, refreshed on `people.changed`.
 *
 * @returns The people query.
 */
export function usePeople() {
  const refresh = useRefreshPeople();
  usePbEvent('people.changed', refresh);
  return useQuery({ queryKey: PEOPLE_KEY, queryFn: () => window.pb.people.list() });
}

/**
 * The first page of a person's faces.
 *
 * @param personId - Person id.
 * @returns The faces query.
 */
export function usePersonFaces(personId: string) {
  return useQuery({
    queryKey: ['person-faces', personId],
    queryFn: () => window.pb.people.faces(personId, null),
  });
}

function usePersonMutations(onSuccess: () => void) {
  return {
    rename: useMutation({
      mutationFn: (v: { id: string; name: string }) => window.pb.people.rename(v.id, v.name),
      onSuccess,
    }),
    merge: useMutation({
      mutationFn: (v: { fromId: string; intoId: string }) =>
        window.pb.people.merge(v.fromId, v.intoId),
      onSuccess,
    }),
  };
}

function useFaceMutations(onSuccess: () => void) {
  return {
    move: useMutation({
      mutationFn: (v: { faceIds: string[]; target: { personId: string } | { newPerson: true } }) =>
        window.pb.people.moveFaces(v.faceIds, v.target),
      onSuccess,
    }),
    reject: useMutation({
      mutationFn: (faceId: string) => window.pb.people.rejectFace(faceId),
      onSuccess,
    }),
    cover: useMutation({
      mutationFn: (v: { personId: string; faceId: string }) =>
        window.pb.people.setCover(v.personId, v.faceId),
      onSuccess,
    }),
  };
}

/**
 * Rename, merge, move, reject and cover actions; each refreshes people views.
 *
 * @returns The mutations.
 */
export function usePeopleActions() {
  const onSuccess = useRefreshPeople();
  return { ...usePersonMutations(onSuccess), ...useFaceMutations(onSuccess) };
}
