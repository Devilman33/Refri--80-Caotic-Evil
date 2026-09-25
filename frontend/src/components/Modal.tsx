import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  /** Se usa como `aria-labelledby`; el wrapper le pone el foco al abrir. */
  titleId: string;
  onClose: () => void;
  /** `modal--wide` para el formulario de movimientos. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * Diálogo accesible: Escape cierra, el foco entra al abrir, el Tab queda atrapado dentro y
 * al cerrar vuelve a quien lo abrió.
 *
 * Los dos modales que existían declaraban `role="dialog" aria-modal="true"` y no
 * implementaban nada de eso: el atributo sin el comportamiento. Con la grilla de posiciones
 * adentro son 81-100 botones enfocables, así que un usuario de teclado entraba y no podía
 * salir.
 *
 * Es un wrapper propio de ~40 líneas y no una dependencia de modales: agregar un paquete
 * para dos diálogos sería peor que escribir esto.
 */
export function Modal({ titleId, onClose, wide, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    // El foco va al título, no al primer control: quien usa lector de pantalla escucha de
    // qué es el diálogo antes de que le lean un campo suelto.
    const heading = dialog?.querySelector<HTMLElement>(`#${CSS.escape(titleId)}`);
    (heading ?? dialog)?.focus();

    return () => {
      openerRef.current?.focus?.();
    };
  }, [titleId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        className={wide ? "modal modal--wide" : "modal"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
