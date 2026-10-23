import { useCallback } from 'react';
import type { Contract, InsertionOrder, Partner } from '@legalio/types';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { useConfirm } from '../../context/ConfirmDialogContext';
import { errorMessage, isApiError } from '../../api/client';
import { useWorkspaceMutations } from './useWorkspaceMutations';

type Mutations = ReturnType<typeof useWorkspaceMutations>;

/**
 * The user-facing side of record changes: confirmation dialogs, toasts and translated messages on top of the optimistic
 * mutations. Saves reject so the open form can stay on screen; deletes report themselves.
 */
export function useWorkspaceActions(mutations: Mutations, reload: () => Promise<void>) {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const confirmDialog = useConfirm();

  const toast = useCallback((type: 'success' | 'warning' | 'error' | 'info', title: string, message: string) => {
    const variant = ({ success: 'success', warning: 'warning', error: 'destructive', info: 'default' } as const)[type];
    showAlert({ title, description: message, variant });
  }, [showAlert]);

  const confirmDelete = useCallback((description: string, confirmLabel?: string) =>
    confirmDialog({ description, tone: 'danger', confirmLabel: confirmLabel ?? t('io.action_delete', 'Hapus') }), [confirmDialog, t]);

  /** A 409 means the record changed under the user: say so plainly (the refresh that follows shows the current version). */
  const saveFailureMessage = (error: unknown, fallback: string) =>
    isApiError(error) && error.code === 'VERSION_CONFLICT'
      ? t('app.record_changed_by_someone', 'Data ini baru saja diubah oleh pengguna lain. Data terbaru sudah dimuat; periksa lalu simpan ulang perubahan Anda.')
      : errorMessage(error, fallback);

  const saveContract = useCallback(async (data: Record<string, any>, editing?: Contract | null) => {
    try {
      await mutations.saveContract(data, editing);
    } catch (error) {
      toast('error', t('app.gagal_menyimpan_kontrak', 'Gagal Menyimpan Kontrak'), saveFailureMessage(error, t('app.gagal_terhubung_ke_server', 'Gagal terhubung ke server.')));
      throw error;
    }
  }, [mutations, toast, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteContract = useCallback(async (id: string) => {
    if (!(await confirmDelete(t('app.hapus_data_kontrak_ini', 'Hapus data kontrak ini?')))) return;
    try {
      await mutations.deleteContract(id);
    } catch (error) {
      toast('error', t('app.gagal_menghapus_kontrak', 'Gagal Menghapus Kontrak'), errorMessage(error, t('app.gagal_menghapus_kontrak_2', 'Gagal menghapus kontrak.')));
    }
  }, [mutations, confirmDelete, toast, t]);

  const saveOrder = useCallback(async (data: Record<string, any>, editing?: InsertionOrder | null) => {
    try {
      await mutations.saveOrder(data, editing);
    } catch (error) {
      toast('error', t('app.gagal_menyimpan_io', 'Gagal Menyimpan IO'), errorMessage(error, t('app.gagal_menyimpan_insertion_order', 'Gagal menyimpan Insertion Order.')));
    }
  }, [mutations, toast, t]);

  const deleteOrder = useCallback(async (id: string) => {
    if (!(await confirmDelete(t('app.hapus_data_insertion_order_io_ini', 'Hapus data Insertion Order (IO) ini?')))) return;
    try {
      await mutations.deleteOrder(id);
    } catch (error) {
      toast('error', t('app.gagal_menghapus_io', 'Gagal Menghapus IO'), errorMessage(error, t('app.gagal_menghapus', 'Gagal menghapus')));
    }
  }, [mutations, confirmDelete, toast, t]);

  const savePartner = useCallback(async (data: Record<string, any>, editing?: Partner | null) => {
    try {
      await mutations.savePartner(data, editing);
    } catch (error) {
      toast('error', t('app.error', 'Error'), errorMessage(error, t('app.gagal_menyimpan_partner', 'Gagal menyimpan partner.')));
    }
  }, [mutations, toast, t]);

  const deletePartner = useCallback(async (id: string, name: string) => {
    const ok = await confirmDelete(
      t('app.hapus_partner_kontrak_io_adendum_notifikasi', 'Hapus partner "{name}"? Kontrak, IO, Adendum & Notifikasi terkait ikut terhapus.', { name }),
      t('admin.btn_confirm_delete', 'Hapus Permanen'),
    );
    if (!ok) return;
    try {
      await mutations.deletePartner(id);
    } catch (error) {
      toast('error', t('app.gagal_menghapus_partner', 'Gagal Menghapus Partner'), errorMessage(error, t('app.gagal_menghapus', 'Gagal menghapus')));
    }
  }, [mutations, confirmDelete, toast, t]);

  const saveAmendment = useCallback(async (data: Record<string, any>) => {
    try {
      await mutations.saveAmendment(data);
    } catch (error) {
      toast('error', t('app.error', 'Error'), errorMessage(error, t('app.gagal_menyimpan_adendum', 'Gagal menyimpan adendum.')));
    }
  }, [mutations, toast, t]);

  /** One confirmation for the whole selection; the refresh afterwards replaces the list. */
  const bulkDelete = useCallback(async (collection: 'contracts' | 'ios' | 'partners', ids: string[], confirmation: string) => {
    if (ids.length === 0) return;
    if (!(await confirmDelete(confirmation))) return;
    const failed = await mutations.bulkDelete(collection, ids);
    if (failed.length > 0) {
      toast('error', t('bulk.delete_failed_title', 'Sebagian gagal dihapus'), t('bulk.delete_failed_message', '{failed} dari {total} gagal dihapus.', { failed: failed.length, total: ids.length }));
    }
  }, [mutations, confirmDelete, toast, t]);

  const markNotificationsRead = useCallback(async (notifId?: string, markAll?: boolean) => {
    try { await mutations.markNotificationsRead(notifId, markAll); } catch { await reload(); }
  }, [mutations, reload]);

  const deleteNotifications = useCallback(async (notifId?: string, notifIds?: string[], deleteAll?: boolean) => {
    try { await mutations.deleteNotifications(notifId, notifIds, deleteAll); } catch { await reload(); }
  }, [mutations, reload]);

  return { toast, saveContract, deleteContract, saveOrder, deleteOrder, savePartner, deletePartner, saveAmendment, bulkDelete, markNotificationsRead, deleteNotifications };
}
