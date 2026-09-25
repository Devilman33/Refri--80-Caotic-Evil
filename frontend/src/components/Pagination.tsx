export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="pagination">
      <span>
        {total} muestra{total === 1 ? "" : "s"} · página {page} de {totalPages}
      </span>
      <button className="btn-ghost" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        Anterior
      </button>
      <button className="btn-ghost" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
        Siguiente
      </button>
    </div>
  );
}
