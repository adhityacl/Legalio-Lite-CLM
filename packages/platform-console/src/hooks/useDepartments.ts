import { useState, useEffect, useCallback } from 'react';
import { getAuthHeaders } from '../lib/apiFetch';
import { useTenant } from '../context/TenantContext';

export function useDepartments() {
  const { activeTenantId } = useTenant();
  const [departments, setDepartments] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDepartments = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/departments', {
        headers: getAuthHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.departments)) {
          setDepartments(data.departments);
          return;
        }
      }
    } catch (err) {
      console.error('Failed to fetch dynamic departments:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTenantId]);

  useEffect(() => {
    fetchDepartments();

    const handleUpdate = () => {
      fetchDepartments();
    };
    window.addEventListener('departments-updated', handleUpdate);
    window.addEventListener('organization-updated', handleUpdate);
    return () => {
      window.removeEventListener('departments-updated', handleUpdate);
      window.removeEventListener('organization-updated', handleUpdate);
    };
  }, [fetchDepartments]);

  return { departments, loading, refreshDepartments: fetchDepartments };
}
