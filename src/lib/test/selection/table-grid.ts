// The mounted table grid as the selection seams read it: a data-block-path wrapper, a
// role="table" grid, data-table-row-idx rows, role="cell" cells. With `box`, the wrapper
// reports it and each row's cells tile it left-to-right; callers attach `host` themselves.

export interface TableGridBox {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface TableGridOptions {
	path: number[];
	rows: number;
	cols: number;
	box?: TableGridBox;
	editableCells?: boolean;
}

export interface TableGrid {
	host: HTMLElement;
	grid: HTMLElement;
	cells: HTMLElement[][];
}

export function mountTableGrid({
	path,
	rows,
	cols,
	box,
	editableCells
}: TableGridOptions): TableGrid {
	const host = document.createElement('div');
	host.setAttribute('data-block-path', JSON.stringify(path));
	host.setAttribute('data-block-kind', 'table');
	if (box) host.getBoundingClientRect = () => box as DOMRect;
	const grid = document.createElement('div');
	grid.setAttribute('role', 'table');
	host.appendChild(grid);

	const cellWidth = box ? (box.right - box.left) / cols : 0;
	const cells: HTMLElement[][] = [];
	for (let r = 0; r < rows; r++) {
		const rowEl = document.createElement('div');
		rowEl.setAttribute('data-table-row-idx', String(r));
		grid.appendChild(rowEl);
		const rowCells: HTMLElement[] = [];
		for (let c = 0; c < cols; c++) {
			const cellEl = document.createElement('div');
			cellEl.setAttribute('role', 'cell');
			if (editableCells) cellEl.setAttribute('contenteditable', 'true');
			if (box) {
				const left = box.left + c * cellWidth;
				cellEl.getBoundingClientRect = () =>
					({ left, right: left + cellWidth, top: box.top, bottom: box.bottom }) as DOMRect;
			}
			rowEl.appendChild(cellEl);
			rowCells.push(cellEl);
		}
		cells.push(rowCells);
	}
	return { host, grid, cells };
}
