var gulp = require('gulp'),
    gutil = require('gulp-util'),
    concat = require('gulp-concat'),
    ts = require('gulp-typescript'),
    merge = require('merge2'),
    strip = require('gulp-strip-comments');

gulp.task('default', ['build']);

gulp.task('build', function(){
    var tsResult = gulp.src(['src/main/**.ts', 'typings/**.ts', 'typings/*/**.ts'])
        .pipe(ts({
            removeComments: false,
            module: 'commonjs',
            noImplicitAny: true,
            target: 'ES5',
            declarationFiles: true,
            noExternalResolve: true,
            sortOutput: true,
            sourceMap: true,
            stripInternal: true
        }));
    var jsResult = gulp.src('src/main/*.js');

    return merge([tsResult.dts.pipe(concat('MFCAuto.d.ts')).pipe(strip()).pipe(gulp.dest('lib')),
        tsResult.js.pipe(concat('MFCAuto.js')).pipe(gulp.dest('lib')),
        jsResult.pipe(gulp.dest('lib'))]);
});

gulp.task('watch', function() {
    gulp.watch('src/main/*', ['default']);
});
