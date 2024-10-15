function pointMatrix(x_min, x_max, y_min, y_max, step_size, i_ini = 1, reverse = false) {
    // Return x coordinates, y coordinates, and point count labels
    // Units of x and y must be same as step_size
    // i_ini is starting point count ID label (default=1)
    // reverse (bool) indicates whether starting in top left (false) or bottom right (true)

    // Start at top-left pixel and progress to the bottom-right in snake-like pattern
    let n_y_rows = Math.floor((y_max - y_min) / step_size) + 1;
    let n_x_cols = Math.floor((x_max - x_min) / step_size) + 1;

    // Make 1D x-axis array that reflects snaking increments from top left to bottom right
    let x_vals = Array.from({ length: n_x_cols }, (_, i) => x_min + i * step_size);
    let X = Array(n_y_rows)
        .fill(0)
        .map((_, rowIndex) => {
            let row = [...x_vals];
            return rowIndex % 2 === 0 ? row : row.reverse();
        })
        .flat();

    // Make 1D y-axis values for the same array
    let y_vals = Array.from({ length: n_y_rows }, (_, i) => y_min + i * step_size);
    let Y = [].concat(...y_vals.map(y => Array(n_x_cols).fill(y)));

    // Define 1D array with point count labels
    let A = Array.from({ length: n_y_rows * n_x_cols }, (_, i) => i + i_ini);

    if (reverse) {
        return [X.reverse(), Y.reverse(), A];
    } else {
        return [X, Y, A];
    }
}

function makePoints(x_min, x_max, y_min, y_max, step_size, num_points) {
    let c = 0; // Counter for total number of points logged
    let d = 1.0; // Counter that reflects decreasing step count
    let e = 0; // Counter to control snake pattern direction (normal or reversed)

    let Xs = [];
    let Ys = [];
    let As = [];
    let legend = [];

    while (c < num_points) {
        let reverse = e % 2 !== 0;

        let [X, Y, A] = pointMatrix(x_min, x_max, y_min, y_max, step_size * d, c, reverse);

        // Remove overlapping points
        let newPoints = X.map((x, i) => [x, Y[i]]);
        let existingPoints = Xs.map((x, i) => [x, Ys[i]]);
        let idxToRemove = newPoints.filter(p => existingPoints.some(e => e[0] === p[0] && e[1] === p[1]));
        let filteredPoints = newPoints.filter(p => !idxToRemove.includes(p));

        X = filteredPoints.map(p => p[0]);
        Y = filteredPoints.map(p => p[1]);
        A = Array.from({ length: X.length }, (_, i) => i + 1 + c);
        
        c += X.length;
        
        if (c <= num_points) {
            Xs = [...Xs, ...X];
            Ys = [...Ys, ...Y];
            As = [...As, ...A];
            legend = [...legend, ...Array(X.length).fill(e + 1)];
            d /= 2.0;
        } else {
            Xs = [...Xs, ...X.slice(0, num_points - c)];
            Ys = [...Ys, ...Y.slice(0, num_points - c)];
            As = [...As, ...A.slice(0, num_points - c)];
            legend = [...legend, ...Array(X.slice(0, num_points - c).length).fill(e + 1)];
            break;
        }

        e += 1;
    }

    return [Xs, Ys, As];
}
// For testing
// let [X, Y, A] = makePoints(0, 20000, 0, 10000, 1000, 861);
// console.log(X);
// console.log(Y);
// console.log(A);

let [X, Y, A]  = makePoints(0, 20000, 0, 10000, 1000, 861);
for (let i = 0; i < X.length; i++) {
    // Get the coordinates in the specified unit.
    const xUnits = X[i];
    const yUnits = Y[i];
    console.log(X[i],Y[i]);
  }
