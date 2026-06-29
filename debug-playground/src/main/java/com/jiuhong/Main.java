package com.jiuhong;

import com.jiuhong.config.AppConfig;
import com.jiuhong.service.UserService;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

/**
 * @author chang xiangyu 2026/5/10
 */
public class Main {

	public static void main(String[] args) {
		// Spring Framework 原生启动方式
		// 在下一行打上断点，Debug 启动
		ApplicationContext context = new AnnotationConfigApplicationContext(AppConfig.class);
		// 从容器中取出 Bean 并调用
		UserService userService = context.getBean(UserService.class);
		userService.hello();
	}

}
