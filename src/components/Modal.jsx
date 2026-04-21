import { useState, useEffect } from 'react';
import styles from '../styles/modal.module.css';

export default function Modal({ isOpen, onClose, title, message, onConfirm, confirmText = 'Xác nhận', cancelText = 'Hủy', type = 'confirm' }) {
  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3>{title}</h3>
          <button className={styles.closeBtn} onClick={onClose}>×</button>
        </div>
        <div className={styles.modalBody}>
          <p>{message}</p>
        </div>
        <div className={styles.modalFooter}>
          {type === 'confirm' ? (
            <>
              <button className={styles.cancelBtn} onClick={onClose}>{cancelText}</button>
              <button className={styles.confirmBtn} onClick={onConfirm}>{confirmText}</button>
            </>
          ) : (
            <button className={styles.confirmBtn} onClick={onClose}>Đóng</button>
          )}
        </div>
      </div>
    </div>
  );
}
